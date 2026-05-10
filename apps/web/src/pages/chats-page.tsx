import { useParams } from 'react-router-dom';
import { ChatsLayout } from '../components/chats/chats-layout.js';

export function ChatsPage() {
  const { sessionId } = useParams();
  return <ChatsLayout activeSessionId={sessionId} />;
}
