import { useOutletContext, useParams } from 'react-router-dom';
import { ChatPanel } from '../components/chats/chat-panel.js';
import type { WorkbenchOutletContext } from '../components/workbench/workbench-layout.js';

export function ChatsPage() {
  const { sessionId } = useParams();
  const { onExpandSidebar, onOpenDrawer, onReconnectCatchup } = useOutletContext<WorkbenchOutletContext>();
  return (
    <ChatPanel
      activeSessionId={sessionId}
      onExpandSidebar={onExpandSidebar}
      onOpenDrawer={onOpenDrawer}
      onReconnectCatchup={onReconnectCatchup}
    />
  );
}
