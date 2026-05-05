import type { SessionRunnerClient } from './session-runner-client.js';
import type { SessionEvent, Store } from './store.js';

/**
 * Handle a client.chat message: insert user turn, write to PTY, emit agent.typing.
 * Returns the agent.typing SessionEvent so callers can publish it to WS clients.
 * Message length is capped at 4000 chars (same as /api/sessions/:id/send limit).
 *
 * Callers are responsible for pushing the returned event to connected WS clients:
 *   - daemon.ts (direct mode): socket.send(JSON.stringify({ type: 'event', event }))
 *   - relay-client.ts (relay mode): send({ type: 'gateway.event', gatewayId, event: toRelayEvent(event) })
 */
export async function handleChatMessage(
  sessionId: string,
  message: string,
  store: Store,
  runnerClient: SessionRunnerClient | undefined
): Promise<SessionEvent> {
  const safeMessage = message.slice(0, 4000);
  store.insertConversationTurn(sessionId, 'user', safeMessage);
  if (runnerClient) {
    await runnerClient.write(`${safeMessage}\n`, 'chat').catch(() => {
      // PTY may have exited
    });
  }
  return store.appendEvent(sessionId, 'agent.typing', {});
}
