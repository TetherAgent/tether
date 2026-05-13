import type { ChatSessionRecord } from '../chats/chat-data.js';

export type WorkbenchSidebarTab = 'chats' | 'terminal';

export type WorkbenchSessionRecord = ChatSessionRecord & {
  kind: WorkbenchSidebarTab;
};

export type WorkbenchSessionGroup = {
  label: string;
  items: WorkbenchSessionRecord[];
};
