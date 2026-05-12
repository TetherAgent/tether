import type { RelayServerToGatewayFrame } from '@tether/protocol';

export type FrameRouterHandlers = {
  onAuthOk: (frame: Extract<RelayServerToGatewayFrame, { type: 'gateway.auth.ok' }>) => void;
  onSessionsRestore: (frame: Extract<RelayServerToGatewayFrame, { type: 'gateway.sessions-restore' }>) => void;
  onAuthFailed: (frame: Extract<RelayServerToGatewayFrame, { type: 'gateway.auth.failed' }>) => void;
  onList: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.list' }>) => void;
  onSubscribe: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.subscribe' }>) => void;
  onInput: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.input' }>) => void;
  onResize: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.resize' }>) => void;
  onStop: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.stop' }>) => void;
  onUnsubscribe: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.unsubscribe' }>) => void;
  onDetach: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.detach' }>) => void;
  onChat: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.chat' }>) => void;
  onListProviders: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.list-providers' }>) => void;
  onCwdSuggest: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.cwd-suggest' }>) => void;
  onSwitchModel: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.switch-model' }>) => void;
  onPermissionResponse: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.permission_response' }>) => void;
  onNewPtySession: (frame: Extract<RelayServerToGatewayFrame, { type: 'client.new-pty-session' }>) => void;
};

export class FrameRouter {
  constructor(private readonly handlers: FrameRouterHandlers) {}

  route(frame: RelayServerToGatewayFrame): void {
    switch (frame.type) {
      case 'gateway.auth.ok':
        this.handlers.onAuthOk(frame);
        return;
      case 'gateway.sessions-restore':
        this.handlers.onSessionsRestore(frame);
        return;
      case 'gateway.auth.failed':
        this.handlers.onAuthFailed(frame);
        return;
      case 'client.list':
        this.handlers.onList(frame);
        return;
      case 'client.subscribe':
        this.handlers.onSubscribe(frame);
        return;
      case 'client.input':
        this.handlers.onInput(frame);
        return;
      case 'client.resize':
        this.handlers.onResize(frame);
        return;
      case 'client.stop':
        this.handlers.onStop(frame);
        return;
      case 'client.unsubscribe':
        this.handlers.onUnsubscribe(frame);
        return;
      case 'client.detach':
        this.handlers.onDetach(frame);
        return;
      case 'client.chat':
        this.handlers.onChat(frame);
        return;
      case 'client.list-providers':
        this.handlers.onListProviders(frame);
        return;
      case 'client.cwd-suggest':
        this.handlers.onCwdSuggest(frame);
        return;
      case 'client.switch-model':
        this.handlers.onSwitchModel(frame);
        return;
      case 'client.permission_response':
        this.handlers.onPermissionResponse(frame);
        return;
      case 'client.new-pty-session':
        this.handlers.onNewPtySession(frame);
        return;
    }
  }
}
