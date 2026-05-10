import * as React from 'react';

export type RelayFrame = Record<string, unknown>;

type RelayApi = {
  sendFrame: (frame: Record<string, unknown>) => boolean;
};

type UseChatRelaySocketOptions = {
  accessToken?: string;
  relayUrl: string;
  onFrame: (frame: RelayFrame, api: RelayApi) => void;
  onClose: () => void;
};

function buildRelayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function frameFromRaw(raw: MessageEvent['data']): RelayFrame | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as RelayFrame;
    return typeof parsed.type === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function useChatRelaySocket({
  accessToken,
  relayUrl,
  onFrame,
  onClose
}: UseChatRelaySocketOptions) {
  const [wsReady, setWsReady] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  const onFrameRef = React.useRef(onFrame);
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const sendFrame = React.useCallback((frame: Record<string, unknown>): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }
    wsRef.current.send(JSON.stringify(frame));
    return true;
  }, []);

  React.useEffect(() => {
    if (!accessToken) {
      setWsReady(false);
      return;
    }
    let closedByCleanup = false;
    const ws = new WebSocket(buildRelayUrl(relayUrl));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    };
    ws.onmessage = (event) => {
      const frame = frameFromRaw(event.data);
      if (!frame) return;
      if (frame.type === 'client.auth.ok') {
        setWsReady(true);
      }
      onFrameRef.current(frame, { sendFrame });
    };
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setWsReady(false);
      if (!closedByCleanup) {
        onCloseRef.current();
      }
    };
    return () => {
      closedByCleanup = true;
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      ws.close();
    };
  }, [accessToken, relayUrl, sendFrame]);

  return { wsReady, sendFrame };
}
