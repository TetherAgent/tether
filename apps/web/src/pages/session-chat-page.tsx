import {
  ChatSessionSurface,
  type ChatSessionSurfaceProps
} from '../components/session/chat-session-surface.js';

export function SessionChatPage(props: ChatSessionSurfaceProps) {
  return <ChatSessionSurface {...props} />;
}
