export type RelayFrame =
  | { type: 'hello'; daemonId: string; token: string }
  | { type: 'subscribe'; sessionId: string; cursor?: number }
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'snapshot'; sessionId: string; text: string }
  | { type: 'event'; sessionId: string; event: unknown }
  | { type: 'error'; message: string };
