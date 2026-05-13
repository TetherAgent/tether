import type { WorkbenchSessionRecord, WorkbenchSessionGroup } from './types.js';

export function compactProjectPath(projectPath: string): string {
  const value = projectPath.trim();
  if (!value) {
    return '未选择工作目录';
  }
  const parts = value.split('/').filter(Boolean);
  if (value.startsWith('/Users/') && parts.length >= 2) {
    const relativeParts = parts.slice(2);
    return relativeParts.length > 0 ? `~/${relativeParts.join('/')}` : '~';
  }
  if (parts.length <= 3) {
    return value;
  }
  return `.../${parts.slice(-3).join('/')}`;
}

export function sessionDisplayTitle(session: WorkbenchSessionRecord): string {
  return session.title || (session.projectPath
    ? (session.projectPath.split('/').pop() ?? session.provider)
    : session.provider) || 'agent';
}

export function groupWorkbenchSessions(
  sessions: WorkbenchSessionRecord[],
  t: { groupToday: string; groupLastWeek: string; groupEarlier: string }
): WorkbenchSessionGroup[] {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const todayItems: WorkbenchSessionRecord[] = [];
  const weekItems: WorkbenchSessionRecord[] = [];
  const olderItems: WorkbenchSessionRecord[] = [];

  for (const session of sessions) {
    const ts = session.lastActiveAt ?? now;
    if (ts >= startOfToday.getTime()) todayItems.push(session);
    else if (ts >= startOfWeek.getTime()) weekItems.push(session);
    else olderItems.push(session);
  }

  const groups: WorkbenchSessionGroup[] = [];
  if (todayItems.length) groups.push({ label: t.groupToday, items: todayItems });
  if (weekItems.length) groups.push({ label: t.groupLastWeek, items: weekItems });
  if (olderItems.length) groups.push({ label: t.groupEarlier, items: olderItems });
  return groups;
}
