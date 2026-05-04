import { SessionSurface, type SessionSurfaceProps } from '../components/session/session-surface.js';

type SessionSimplePageProps = Omit<SessionSurfaceProps, 'surfaceMode' | 'isSimplePage'>;

export function SessionSimplePage(props: SessionSimplePageProps) {
  return <SessionSurface {...props} surfaceMode="control" isSimplePage />;
}
