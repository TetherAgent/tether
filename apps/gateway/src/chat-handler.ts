import type { SessionRunnerClient } from './session-runner-client.js';
import type { SessionEvent, Store } from './store.js';

export type ChatPtyWriter = (data: string, clientId: string) => Promise<void> | void;

/**
 * Handle a client.chat message: insert user turn, write to PTY, emit user turn + agent.typing.
 * Returns publishable SessionEvents so all subscribed clients can update in real time.
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
  runnerClient: SessionRunnerClient | undefined,
  ptyWriter?: ChatPtyWriter
): Promise<SessionEvent[]> {
  const safeMessage = message.slice(0, 4000);
  const turnIndex = store.insertConversationTurn(sessionId, 'user', safeMessage);
  const userTurn = store.appendEvent(sessionId, 'agent.turn', {
    role: 'user',
    content: safeMessage,
    tools: [],
    turnIndex
  });
  if (runnerClient) {
    await runnerClient.write(safeMessage, 'chat');
    await runnerClient.write('\r', 'chat');
  } else if (ptyWriter) {
    await ptyWriter(safeMessage, 'chat');
    await ptyWriter('\r', 'chat');
  }
  const typing = store.appendEvent(sessionId, 'agent.typing', {});
  return [userTurn, typing];
}
