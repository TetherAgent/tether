import type { ChatSessionRecord } from '../chats/data/chat-data.js';

export type WorkbenchSidebarTab = 'chats' | 'terminal' | 'approvals';
export type WorkbenchSessionKind = 'chats' | 'terminal';

export type WorkbenchSessionRecord = ChatSessionRecord & {
  kind: WorkbenchSessionKind;
};

export type WorkbenchSessionGroup = {
  label: string;
  items: WorkbenchSessionRecord[];
};
