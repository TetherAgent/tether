import type {
  RelayGatewayToServerFrame,
  RelaySession,
  RelayTerminalEvent,
  TrustedChatSessionMetadata
} from '@tether/protocol';

export type RelayFrameSender = (frame: RelayGatewayToServerFrame) => void;

export class RelaySender {
  constructor(
    private readonly sendFrame: RelayFrameSender,
    private readonly gatewayId: () => string
  ) {}

  sessions(sessions: RelaySession[]): void {
    this.sendFrame({
      type: 'gateway.sessions',
      gatewayId: this.gatewayId(),
      sessions
    });
  }

  event(event: RelayTerminalEvent): void {
    this.sendFrame({
      type: 'gateway.event',
      gatewayId: this.gatewayId(),
      event
    });
  }

  error(clientId: string | undefined, sessionId: string | undefined, code: string, message: string): void {
    this.sendFrame({
      type: 'gateway.error',
      gatewayId: this.gatewayId(),
      clientId,
      sessionId,
      code,
      message
    });
  }

  sessionCreated(clientId: string, sessionId: string): void {
    this.sendFrame({
      type: 'gateway.session-created',
      gatewayId: this.gatewayId(),
      clientId,
      sessionId
    });
  }

  chatSessionCreated(clientId: string, session: TrustedChatSessionMetadata): void {
    this.sendFrame({
      type: 'gateway.chat-session-created',
      gatewayId: this.gatewayId(),
      clientId,
      session
    });
  }

  chatCatchup(clientId: string, sessionId: string, text: string): void {
    this.sendFrame({
      type: 'gateway.chat-catchup',
      gatewayId: this.gatewayId(),
      clientId,
      sessionId,
      text
    });
  }

  replay(
    clientId: string,
    sessionId: string,
    events: RelayTerminalEvent[],
    latestEventId: number,
    done = true
  ): void {
    this.sendFrame({
      type: 'gateway.replay',
      gatewayId: this.gatewayId(),
      clientId,
      sessionId,
      events,
      done,
      latestEventId
    });
  }
}
