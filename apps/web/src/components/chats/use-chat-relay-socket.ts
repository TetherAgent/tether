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

type RelaySubscriber = {
  onFrameRef: React.MutableRefObject<UseChatRelaySocketOptions['onFrame']>;
  onCloseRef: React.MutableRefObject<UseChatRelaySocketOptions['onClose']>;
  setWsReady: React.Dispatch<React.SetStateAction<boolean>>;
};

type SharedRelaySocket = {
  key: string;
  ws: WebSocket | null;
  ready: boolean;
  activeSubscriber?: RelaySubscriber;
};

let sharedRelaySocket: SharedRelaySocket | undefined;

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

function sendSharedFrame(frame: Record<string, unknown>): boolean {
  const ws = sharedRelaySocket?.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(JSON.stringify(frame));
  return true;
}

function closeSharedSocket(socket: SharedRelaySocket | undefined = sharedRelaySocket) {
  if (!socket) return;
  const ws = socket.ws;
  socket.ws = null;
  socket.ready = false;
  socket.activeSubscriber?.setWsReady(false);
  if (sharedRelaySocket === socket) {
    sharedRelaySocket = undefined;
  }
  if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
    ws.close();
  }
}

function openSharedSocket(key: string, relayUrl: string, accessToken: string): SharedRelaySocket {
  const socket: SharedRelaySocket = {
    key,
    ws: null,
    ready: false
  };
  const ws = new WebSocket(buildRelayUrl(relayUrl));
  socket.ws = ws;
  sharedRelaySocket = socket;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
  };
  ws.onmessage = (event) => {
    const frame = frameFromRaw(event.data);
    if (!frame || sharedRelaySocket !== socket) return;
    if (frame.type === 'client.auth.ok') {
      socket.ready = true;
      socket.activeSubscriber?.setWsReady(true);
    }
    socket.activeSubscriber?.onFrameRef.current(frame, { sendFrame: sendSharedFrame });
  };
  ws.onclose = () => {
    if (sharedRelaySocket !== socket) return;
    socket.ws = null;
    socket.ready = false;
    socket.activeSubscriber?.setWsReady(false);
    socket.activeSubscriber?.onCloseRef.current();
  };

  return socket;
}

export function useChatRelaySocket({
  accessToken,
  relayUrl,
  onFrame,
  onClose
}: UseChatRelaySocketOptions) {
  const [wsReady, setWsReady] = React.useState(false);
  const onFrameRef = React.useRef(onFrame);
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const sendFrame = React.useCallback(sendSharedFrame, []);

  React.useEffect(() => {
    if (!accessToken) {
      setWsReady(false);
      return;
    }
    const key = `${relayUrl}\n${accessToken}`;
    const subscriber: RelaySubscriber = {
      onFrameRef,
      onCloseRef,
      setWsReady
    };

    if (sharedRelaySocket && sharedRelaySocket.key !== key) {
      closeSharedSocket(sharedRelaySocket);
    }

    let socket = sharedRelaySocket;
    if (!socket || !socket.ws || socket.ws.readyState === WebSocket.CLOSED || socket.ws.readyState === WebSocket.CLOSING) {
      socket = openSharedSocket(key, relayUrl, accessToken);
    }

    socket.activeSubscriber = subscriber;
    setWsReady(socket.ready);

    return () => {
      if (sharedRelaySocket !== socket || socket.activeSubscriber !== subscriber) {
        return;
      }
      socket.activeSubscriber = undefined;
      setWsReady(false);
    };
  }, [accessToken, relayUrl]);

  return { wsReady, sendFrame };
}
