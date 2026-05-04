import {
  ChatSessionSurface,
  type ChatSessionSurfaceProps
} from '../components/session/chat-session-surface.js';

export function SessionSimplePage(props: ChatSessionSurfaceProps) {
  return <ChatSessionSurface {...props} />;
}
