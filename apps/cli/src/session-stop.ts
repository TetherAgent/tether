export type StoppableSession = {
  id: string;
  status: string;
};

export function runningSessionIds(sessions: StoppableSession[]): string[] {
  return sessions.filter((session) => session.status === 'running').map((session) => session.id);
}
