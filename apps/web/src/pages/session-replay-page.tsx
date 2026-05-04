import { SessionSurface, type SessionSurfaceProps } from '../components/session/session-surface.js';

type SessionReplayPageProps = Omit<SessionSurfaceProps, 'surfaceMode'>;

export function SessionReplayPage(props: SessionReplayPageProps) {
  return <SessionSurface {...props} surfaceMode="replay" />;
}
