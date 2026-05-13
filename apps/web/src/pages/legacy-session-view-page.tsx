import * as React from 'react';
import { Navigate, useParams } from 'react-router-dom';

import { readWebRelayUrl } from '../config/default-deployment.js';
import { SessionControlPage } from './session-control-page.js';
import { SessionReplayPage } from './session-replay-page.js';

type LegacySessionViewPageProps = {
  mode: 'control' | 'replay';
};

type ConnectionSettings = {
  relayUrl: string;
  relaySecret: string;
};

const RELAY_SECRET_KEY = 'tether:relaySecret';

function readConnectionSettings(): ConnectionSettings {
  return {
    relayUrl: readWebRelayUrl(),
    relaySecret: window.localStorage.getItem(RELAY_SECRET_KEY) ?? ''
  };
}

export function LegacySessionViewPage({ mode }: LegacySessionViewPageProps) {
  const { sessionId } = useParams();
  const [connectionSettings, setConnectionSettings] = React.useState<ConnectionSettings>(readConnectionSettings);

  if (!sessionId) {
    return <Navigate replace to="/chats" />;
  }

  const props = {
    sessionId,
    connectionSettings,
    onConnectionSettingsChange: setConnectionSettings
  };

  return mode === 'replay' ? <SessionReplayPage {...props} /> : <SessionControlPage {...props} />;
}
