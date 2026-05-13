import * as React from 'react';

export type RelayFrame = Record<string, unknown>;

type RelayFrameHandler = (frame: RelayFrame, api: RelayClientApi) => void;
type RelayCloseHandler = () => void;
type RelaySubscriptionMode = 'control' | 'observe';

export type RelaySessionSubscriptionInput = {
  after?: number;
  cols?: number;
  mode: RelaySubscriptionMode;
  owner: string;
  rows?: number;
  sessionId: string;
  tail?: number;
};

export type RelaySessionSummary = {
  id: string;
  gatewayId?: string;
  provider?: string;
  projectPath?: string;
  status?: string;
  transport?: string;
};

export type GatewayRuntimeStatus = {
  gatewayId: string;
  lastSeenAt: number;
  source: 'auth' | 'hello' | 'session' | 'status';
  status: 'connected' | 'disconnected';
  version?: string;
};

export type RelayClientApi = {
  sendFrame: (frame: Record<string, unknown>) => boolean;
};

type RelayClientContextValue = RelayClientApi & {
  wsReady: boolean;
  connectionEpoch: number;
  defaultGatewayId?: string;
  gatewayConnected: boolean;
  gatewayIdsOnline: Set<string>;
  gatewayStatusById: Record<string, GatewayRuntimeStatus>;
  relaySessions: RelaySessionSummary[];
  relaySessionsVersion: number;
  acquireSessionSubscription: (input: RelaySessionSubscriptionInput) => () => void;
  subscribeFrame: (handler: RelayFrameHandler) => () => void;
  subscribeClose: (handler: RelayCloseHandler) => () => void;
};

type RelayClientProviderProps = {
  accessToken?: string;
  children: React.ReactNode;
  relayUrl: string;
};

const RelayClientContext = React.createContext<RelayClientContextValue | null>(null);
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

function isRelaySessionSummary(value: unknown): value is RelaySessionSummary {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function preferredSubscription(
  owners: Map<string, RelaySessionSubscriptionInput>
): RelaySessionSubscriptionInput | undefined {
  return Array.from(owners.values()).find((input) => input.mode === 'control')
    ?? owners.values().next().value as RelaySessionSubscriptionInput | undefined;
}

export function RelayClientProvider({ accessToken, children, relayUrl }: RelayClientProviderProps) {
  const [wsReady, setWsReady] = React.useState(false);
  const [connectionEpoch, setConnectionEpoch] = React.useState(0);
  const [gatewayStatusById, setGatewayStatusById] = React.useState<Record<string, GatewayRuntimeStatus>>({});
  const [relaySessions, setRelaySessions] = React.useState<RelaySessionSummary[]>([]);
  const [relaySessionsVersion, setRelaySessionsVersion] = React.useState(0);
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<number | undefined>(undefined);
  const frameHandlersRef = React.useRef(new Set<RelayFrameHandler>());
  const closeHandlersRef = React.useRef(new Set<RelayCloseHandler>());
  const sessionSubscriptionsRef = React.useRef(new Map<string, Map<string, RelaySessionSubscriptionInput>>());

  const sendFrame = React.useCallback((frame: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  const markGatewayStatus = React.useCallback((
    gatewayId: string,
    status: GatewayRuntimeStatus['status'],
    source: GatewayRuntimeStatus['source'],
    version?: string
  ) => {
    setGatewayStatusById((current) => {
      const existing = current[gatewayId];
      if (source === 'session' && existing?.source === 'status' && existing.status === 'disconnected') {
        return current;
      }
      return {
        ...current,
        [gatewayId]: {
          gatewayId,
          lastSeenAt: Date.now(),
          source,
          status,
          version: version ?? existing?.version
        }
      };
    });
  }, []);

  const subscribeFrame = React.useCallback((handler: RelayFrameHandler): (() => void) => {
    frameHandlersRef.current.add(handler);
    return () => {
      frameHandlersRef.current.delete(handler);
    };
  }, []);

  const subscribeClose = React.useCallback((handler: RelayCloseHandler): (() => void) => {
    closeHandlersRef.current.add(handler);
    return () => {
      closeHandlersRef.current.delete(handler);
    };
  }, []);

  const sendSubscribeFrame = React.useCallback((input: RelaySessionSubscriptionInput): boolean => sendFrame({
    type: 'client.subscribe',
    sessionId: input.sessionId,
    mode: input.mode,
    after: input.after,
    tail: input.tail,
    cols: input.cols,
    rows: input.rows
  }), [sendFrame]);

  const acquireSessionSubscription = React.useCallback((input: RelaySessionSubscriptionInput): (() => void) => {
    const existingOwners = sessionSubscriptionsRef.current.get(input.sessionId);
    const owners = existingOwners ?? new Map<string, RelaySessionSubscriptionInput>();
    const previousPreferred = preferredSubscription(owners);
    owners.set(input.owner, input);
    sessionSubscriptionsRef.current.set(input.sessionId, owners);
    const nextPreferred = preferredSubscription(owners);
    if (
      !previousPreferred ||
      previousPreferred.mode !== nextPreferred?.mode ||
      previousPreferred.owner === input.owner
    ) {
      sendSubscribeFrame(nextPreferred ?? input);
    }

    return () => {
      const currentOwners = sessionSubscriptionsRef.current.get(input.sessionId);
      if (!currentOwners) return;
      const currentPreferred = preferredSubscription(currentOwners);
      currentOwners.delete(input.owner);
      if (currentOwners.size === 0) {
        sessionSubscriptionsRef.current.delete(input.sessionId);
        sendFrame({ type: 'client.unsubscribe', sessionId: input.sessionId });
        return;
      }
      const nextPreferredAfterRelease = preferredSubscription(currentOwners);
      if (currentPreferred?.owner === input.owner && nextPreferredAfterRelease) {
        sendSubscribeFrame(nextPreferredAfterRelease);
      }
    };
  }, [sendFrame, sendSubscribeFrame]);

  React.useEffect(() => {
    if (!accessToken) {
      setWsReady(false);
      setGatewayStatusById({});
      setRelaySessions([]);
      setRelaySessionsVersion(0);
      return undefined;
    }

    let disposed = false;
    let ws: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== undefined) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = undefined;
      }
    };

    const scheduleReconnect = (immediate = false) => {
      if (disposed) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      clearReconnectTimer();
      const delay = immediate
        ? 0
        : RECONNECT_DELAYS_MS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1)]!;
      if (!immediate) {
        reconnectAttemptRef.current += 1;
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      ws = new WebSocket(buildRelayUrl(relayUrl));
      wsRef.current = ws;
      setWsReady(false);

      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
      };
      ws.onmessage = (event) => {
        const frame = frameFromRaw(event.data);
        if (!frame || disposed || wsRef.current !== ws) return;
        if (frame.type === 'client.auth.ok') {
          setWsReady(true);
          reconnectAttemptRef.current = 0;
          setConnectionEpoch((epoch) => epoch + 1);
          if (typeof frame.gatewayId === 'string') {
            markGatewayStatus(frame.gatewayId, 'connected', 'auth');
          }
          for (const owners of sessionSubscriptionsRef.current.values()) {
            const subscription = preferredSubscription(owners);
            if (subscription) {
              sendSubscribeFrame(subscription);
            }
          }
        }
        if (frame.type === 'hello' && typeof frame.gatewayId === 'string') {
          markGatewayStatus(frame.gatewayId, 'connected', 'hello');
        }
        if (frame.type === 'gateway.status' && typeof frame.gatewayId === 'string') {
          const status = frame.status === 'disconnected' ? 'disconnected' : 'connected';
          markGatewayStatus(
            frame.gatewayId,
            status,
            'status',
            typeof frame.version === 'string' ? frame.version : undefined
          );
        }
        if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
          const nextSessions = frame.sessions.filter(isRelaySessionSummary);
          setRelaySessions(nextSessions);
          for (const session of nextSessions) {
            if (session.gatewayId) {
              markGatewayStatus(session.gatewayId, 'connected', 'session');
            }
          }
          setRelaySessionsVersion((version) => version + 1);
        }
        for (const handler of frameHandlersRef.current) {
          handler(frame, { sendFrame });
        }
      };
      ws.onclose = () => {
        if (disposed || wsRef.current !== ws) return;
        wsRef.current = null;
        setWsReady(false);
        for (const handler of closeHandlersRef.current) {
          handler();
        }
        scheduleReconnect();
      };
    };

    const reconnectWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleReconnect(true);
      }
    };
    const reconnectWhenOnline = () => {
      scheduleReconnect(true);
    };

    connect();
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    window.addEventListener('online', reconnectWhenOnline);

    return () => {
      disposed = true;
      clearReconnectTimer();
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
      window.removeEventListener('online', reconnectWhenOnline);
      const currentWs = wsRef.current;
      wsRef.current = null;
      setWsReady(false);
      setGatewayStatusById({});
      setRelaySessions([]);
      setRelaySessionsVersion(0);
      if (currentWs && currentWs.readyState !== WebSocket.CLOSED && currentWs.readyState !== WebSocket.CLOSING) {
        currentWs.close();
      }
    };
  }, [accessToken, markGatewayStatus, relayUrl, sendFrame, sendSubscribeFrame]);

  const gatewayIdsOnline = React.useMemo(() => {
    if (!wsReady) {
      return new Set<string>();
    }
    const ids = Object.values(gatewayStatusById)
      .filter((status) => status.status === 'connected')
      .map((status) => status.gatewayId);
    return new Set(ids);
  }, [gatewayStatusById, wsReady]);

  const defaultGatewayId = React.useMemo(() => {
    const connected = Object.values(gatewayStatusById)
      .filter((status) => status.status === 'connected')
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return connected[0]?.gatewayId;
  }, [gatewayStatusById]);

  const gatewayConnected = wsReady && gatewayIdsOnline.size > 0;

  const value = React.useMemo<RelayClientContextValue>(() => ({
    acquireSessionSubscription,
    connectionEpoch,
    defaultGatewayId,
    gatewayConnected,
    gatewayIdsOnline,
    gatewayStatusById,
    relaySessions,
    relaySessionsVersion,
    sendFrame,
    subscribeClose,
    subscribeFrame,
    wsReady
  }), [acquireSessionSubscription, connectionEpoch, defaultGatewayId, gatewayConnected, gatewayIdsOnline, gatewayStatusById, relaySessions, relaySessionsVersion, sendFrame, subscribeClose, subscribeFrame, wsReady]);

  return (
    <RelayClientContext.Provider value={value}>
      {children}
    </RelayClientContext.Provider>
  );
}

export function useRelayClient(): RelayClientContextValue {
  const context = React.useContext(RelayClientContext);
  if (!context) {
    throw new Error('useRelayClient must be used inside RelayClientProvider');
  }
  return context;
}
