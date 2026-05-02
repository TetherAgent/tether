import { runtimeStore, type AuditEventRecord } from './runtime';
import { insertAuditEvent, loadAuditEvents, mysqlModeEnabled } from './storage';

function maskString(value: string): string {
  if (value.length <= 8) {
    return '[masked]';
  }
  return `${value.slice(0, 4)}...[masked]`;
}

function maskSensitivePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowered = key.toLowerCase();
    if (lowered.includes('token') || lowered.includes('secret') || lowered.includes('password')) {
      next[key] = typeof value === 'string' ? maskString(value) : '[masked]';
      continue;
    }
    if (typeof value === 'string' && /(sk-[\w-]+|Bearer\s+[A-Za-z0-9._-]+)/i.test(value)) {
      next[key] = maskString(value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

export async function recordAuditEvent(input: Omit<AuditEventRecord, 'id' | 'createdAt'>) {
  const payload = maskSensitivePayload(input.payload);
  if (mysqlModeEnabled()) {
    return await insertAuditEvent({
      ...input,
      payload
    });
  }

  const store = runtimeStore();
  const event: AuditEventRecord = {
    id: store.nextAuditId++,
    createdAt: Date.now(),
    ...input,
    payload
  };
  store.auditEvents.push(event);
  return event;
}

export async function auditEvents() {
  if (mysqlModeEnabled()) {
    return await loadAuditEvents();
  }
  return runtimeStore().auditEvents;
}
