import { Service } from 'egg';

import type { AuditEventRecord } from './runtime';

export default class AuditService extends Service {
  private maskString(value: string): string {
    if (value.length <= 8) {
      return '[masked]';
    }
    return `${value.slice(0, 4)}...[masked]`;
  }

  private maskSensitivePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const lowered = key.toLowerCase();
      if (lowered.includes('token') || lowered.includes('secret') || lowered.includes('password')) {
        next[key] = typeof value === 'string' ? this.maskString(value) : '[masked]';
        continue;
      }
      if (typeof value === 'string' && /(sk-[\w-]+|Bearer\s+[A-Za-z0-9._-]+)/i.test(value)) {
        next[key] = this.maskString(value);
        continue;
      }
      next[key] = value;
    }
    return next;
  }

  public async recordAuditEvent(input: Omit<AuditEventRecord, 'id' | 'createdAt'>) {
    const { ctx } = this;
    if (!input.accountId || input.accountId === 'undefined') {
      ctx.throw(400, 'accountId 必填');
    }

    const payload = this.maskSensitivePayload(input.payload);

    return await ctx.service.auditRepository.insertAuditEvent({
      ...input,
      payload
    });
  }

  public async auditEvents() {
    const { ctx } = this;
    return await ctx.service.auditRepository.loadAuditEvents();
  }
}
