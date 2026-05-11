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
  setConnectionEpoch: React.Dispatch<React.SetStateAction<number>>;
};

type SharedRelaySocket = {
  key: string;
  relayUrl: string;
  accessToken: string;
  ws: WebSocket | null;
  ready: boolean;
  reconnectAttempt: number;
  reconnectTimer?: number;
  activeSubscriber?: RelaySubscriber;
};

let sharedRelaySocket: SharedRelaySocket | undefined;

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];

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
  if (socket.reconnectTimer !== undefined) {
    window.clearTimeout(socket.reconnectTimer);
    socket.reconnectTimer = undefined;
  }
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

function scheduleReconnect(socket: SharedRelaySocket, immediate = false) {
  if (sharedRelaySocket !== socket || !socket.activeSubscriber) {
    return;
  }
  if (socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (socket.reconnectTimer !== undefined) {
    window.clearTimeout(socket.reconnectTimer);
  }
  const delay = immediate
    ? 0
    : RECONNECT_DELAYS_MS[Math.min(socket.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
  if (!immediate) {
    socket.reconnectAttempt += 1;
  }
  socket.reconnectTimer = window.setTimeout(() => {
    socket.reconnectTimer = undefined;
    connectSharedSocket(socket);
  }, delay);
}

function connectSharedSocket(socket: SharedRelaySocket) {
  if (sharedRelaySocket !== socket || !socket.activeSubscriber) {
    return;
  }
  if (socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const ws = new WebSocket(buildRelayUrl(socket.relayUrl));
  socket.ws = ws;
  socket.ready = false;
  socket.activeSubscriber?.setWsReady(false);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'client.auth', token: socket.accessToken }));
  };
  ws.onmessage = (event) => {
    const frame = frameFromRaw(event.data);
    if (!frame || sharedRelaySocket !== socket || socket.ws !== ws) return;
    if (frame.type === 'client.auth.ok') {
      socket.ready = true;
      socket.reconnectAttempt = 0;
      socket.activeSubscriber?.setWsReady(true);
      socket.activeSubscriber?.setConnectionEpoch((epoch) => epoch + 1);
    }
    socket.activeSubscriber?.onFrameRef.current(frame, { sendFrame: sendSharedFrame });
  };
  ws.onclose = () => {
    if (sharedRelaySocket !== socket || socket.ws !== ws) return;
    socket.ws = null;
    socket.ready = false;
    socket.activeSubscriber?.setWsReady(false);
    socket.activeSubscriber?.onCloseRef.current();
    scheduleReconnect(socket);
  };
}

function openSharedSocket(key: string, relayUrl: string, accessToken: string): SharedRelaySocket {
  const socket: SharedRelaySocket = {
    key,
    relayUrl,
    accessToken,
    ws: null,
    ready: false,
    reconnectAttempt: 0
  };
  sharedRelaySocket = socket;

  return socket;
}

export function useChatRelaySocket({
  accessToken,
  relayUrl,
  onFrame,
  onClose
}: UseChatRelaySocketOptions) {
  const [wsReady, setWsReady] = React.useState(false);
  const [connectionEpoch, setConnectionEpoch] = React.useState(0);
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
      setWsReady,
      setConnectionEpoch
    };

    if (sharedRelaySocket && sharedRelaySocket.key !== key) {
      closeSharedSocket(sharedRelaySocket);
    }

    let socket = sharedRelaySocket;
    if (!socket) {
      socket = openSharedSocket(key, relayUrl, accessToken);
    }

    socket.activeSubscriber = subscriber;
    if (!socket.ws || socket.ws.readyState === WebSocket.CLOSED || socket.ws.readyState === WebSocket.CLOSING) {
      connectSharedSocket(socket);
    }
    setWsReady(socket.ready);

    const reconnectWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleReconnect(socket, true);
      }
    };
    const reconnectWhenOnline = () => {
      scheduleReconnect(socket, true);
    };
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    window.addEventListener('online', reconnectWhenOnline);

    return () => {
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
      window.removeEventListener('online', reconnectWhenOnline);
      if (sharedRelaySocket !== socket || socket.activeSubscriber !== subscriber) {
        return;
      }
      socket.activeSubscriber = undefined;
      setWsReady(false);
    };
  }, [accessToken, relayUrl]);

  return { wsReady, sendFrame, connectionEpoch };
}
