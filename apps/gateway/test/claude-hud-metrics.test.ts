import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeHudMetricsStore } from '../src/chat/claude-hud-metrics.js';

test('ClaudeHudMetricsStore returns metrics when hook arrives before result', async () => {
  const store = new ClaudeHudMetricsStore();
  const accepted = store.acceptHookPayload({
    tetherSessionId: 'tth_session',
    contextWindow: { used_percentage: 42.4 },
    rateLimits: {
      five_hour: { used_percentage: 65, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 20, resets_at: 1_800_010_000 }
    }
  });
  assert.equal(accepted.accepted, true);
  const metrics = await store.waitForMetrics('tth_session', 10);
  assert.deepEqual(metrics, {
    contextUsedPercentage: 42,
    rateLimitInfo: {
      primary: { usedPercent: 65, windowMinutes: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 20, windowMinutes: 10_080, resetsAt: 1_800_010_000 }
    }
  });
});

test('ClaudeHudMetricsStore resolves waiter when result waits before hook', async () => {
  const store = new ClaudeHudMetricsStore();
  const wait = store.waitForMetrics('tth_session', 200);
  const accepted = store.acceptHookPayload({
    tetherSessionId: 'tth_session',
    contextWindow: { usedPercent: 87 }
  });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(await wait, { contextUsedPercentage: 87 });
});

test('ClaudeHudMetricsStore rejects hook payloads without Tether session id', () => {
  const store = new ClaudeHudMetricsStore();
  const accepted = store.acceptHookPayload({
    claudeSessionId: 'claude-session',
    contextWindow: { used_percentage: 50 }
  });
  assert.deepEqual(accepted, { accepted: false, reason: 'missing_tether_session_id' });
});
