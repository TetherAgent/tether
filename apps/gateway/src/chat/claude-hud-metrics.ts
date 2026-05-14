import type { RateLimitInfo } from './chat-session-runner.js';

export type ClaudeHudMetrics = {
  contextUsedPercentage?: number;
  rateLimitInfo?: RateLimitInfo;
};

export type ClaudeHudMetricsAcceptResult =
  | { accepted: true; sessionId: string; metrics: ClaudeHudMetrics }
  | { accepted: false; reason: string };

type Waiter = {
  resolve: (metrics: ClaudeHudMetrics | null) => void;
  timer: NodeJS.Timeout;
};

export class ClaudeHudMetricsStore {
  private readonly metricsBySessionId = new Map<string, { metrics: ClaudeHudMetrics; expiresAt: number }>();
  private readonly waitersBySessionId = new Map<string, Waiter>();

  constructor(private readonly ttlMs = 60_000) {}

  acceptHookPayload(payload: unknown): ClaudeHudMetricsAcceptResult {
    const raw = objectValue(payload);
    if (!raw) return { accepted: false, reason: 'invalid_payload' };
    const sessionId = stringValue(raw.tetherSessionId) ?? stringValue(raw.tether_session_id);
    if (!sessionId) return { accepted: false, reason: 'missing_tether_session_id' };
    const metrics = metricsFromPayload(raw);
    if (metrics.contextUsedPercentage === undefined && !metrics.rateLimitInfo) {
      return { accepted: false, reason: 'missing_metrics' };
    }
    this.store(sessionId, metrics);
    return { accepted: true, sessionId, metrics };
  }

  waitForMetrics(sessionId: string, timeoutMs = 500): Promise<ClaudeHudMetrics | null> {
    this.pruneExpired();
    const existing = this.metricsBySessionId.get(sessionId);
    if (existing) {
      this.metricsBySessionId.delete(sessionId);
      return Promise.resolve(existing.metrics);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waitersBySessionId.delete(sessionId);
        resolve(null);
      }, timeoutMs);
      timer.unref();
      this.waitersBySessionId.set(sessionId, { resolve, timer });
    });
  }

  private store(sessionId: string, metrics: ClaudeHudMetrics): void {
    const waiter = this.waitersBySessionId.get(sessionId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waitersBySessionId.delete(sessionId);
      waiter.resolve(metrics);
      return;
    }
    this.metricsBySessionId.set(sessionId, {
      metrics,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.metricsBySessionId) {
      if (entry.expiresAt <= now) this.metricsBySessionId.delete(sessionId);
    }
  }
}

function metricsFromPayload(raw: Record<string, unknown>): ClaudeHudMetrics {
  const context = objectValue(raw.contextWindow) ?? objectValue(raw.context_window);
  const contextUsedPercentage = percentValue(context?.used_percentage ?? context?.usedPercent);
  const rateLimits = objectValue(raw.rateLimits) ?? objectValue(raw.rate_limits);
  const primary = rateLimitWindow(rateLimits?.five_hour ?? rateLimits?.primary, 300);
  const secondary = rateLimitWindow(rateLimits?.seven_day ?? rateLimits?.secondary, 10_080);
  const rateLimitInfo: RateLimitInfo | undefined = primary || secondary
    ? {
        ...(primary ? { primary } : {}),
        ...(secondary ? { secondary } : {})
      }
    : undefined;
  return {
    ...(contextUsedPercentage !== undefined ? { contextUsedPercentage } : {}),
    ...(rateLimitInfo ? { rateLimitInfo } : {})
  };
}

function rateLimitWindow(value: unknown, windowMinutes: number): { usedPercent: number; windowMinutes?: number; resetsAt?: number } | undefined {
  const raw = objectValue(value);
  if (!raw) return undefined;
  const usedPercent = percentValue(raw.used_percentage ?? raw.usedPercent);
  if (usedPercent === undefined) return undefined;
  const resetsAt = unixSeconds(raw.resets_at ?? raw.resetsAt);
  return {
    usedPercent,
    windowMinutes,
    ...(resetsAt !== undefined ? { resetsAt } : {})
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function percentValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
