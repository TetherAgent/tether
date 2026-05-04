import { SessionSurface, type SessionSurfaceProps } from '../components/session/session-surface.js';

type SessionControlPageProps = Omit<SessionSurfaceProps, 'surfaceMode'>;

export function SessionControlPage(props: SessionControlPageProps) {
  return <SessionSurface {...props} surfaceMode="control" />;
}
