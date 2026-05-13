import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Maximize2, Minimize2, Power } from 'lucide-react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@tether/design';

import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { gatewayAuthHeaders, readGatewayData } from '../../lib/api.js';
import { RelayClientProvider } from '../relay/relay-client-provider.js';
import { type RelayFrame, useRelayClient } from '../relay/use-relay-client.js';
import { SessionDetailHeader, TerminalSurfaceSkeleton } from '../session/session-detail-chrome.js';

type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: string;
  transport?: string;
  agentSessionId?: string;
  lastActiveAt: number;
};

type ClientMode = 'control' | 'observe';
type ReplayMode = 'recent' | 'all';

type ConnectionSettings = {
  relayUrl: string;
  relaySecret: string;
};

type AgentRuntimeStatus = 'idle' | 'submitted' | 'running' | 'responding' | 'done' | 'exited' | 'disconnected';
type TerminalThemeOverride = Pick<ITheme, 'foreground' | 'background' | 'cursor'>;

type SessionEvent = {
  id: number;
  sessionId?: string;
  type: string;
  payload: Record<string, unknown>;
};

const RECENT_REPLAY_EVENT_LIMIT = 100;
const RELAY_INITIAL_EVENT_LIMIT = 5000;
const FULL_REPLAY_EVENT_PAGE_LIMIT = 5000;
const WEB_CLIENT_MODE_KEY = 'tether:webClientMode';
const WEB_REPLAY_MODE_KEY = 'tether:webReplayMode';
const COMPOSER_ENTER_DELAY_MS = 120;
const TERMINAL_ENTER = '\r';
const REPLAY_FLUSH_BUDGET_MS = 8;
const REPLAY_FLUSH_MAX_CHARS = 128 * 1024;

type WebMessages = ReturnType<typeof useI18n>['t'];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readClientMode(): ClientMode {
  return window.localStorage.getItem(WEB_CLIENT_MODE_KEY) === 'observe' ? 'observe' : 'control';
}

function readReplayMode(): ReplayMode {
  return window.localStorage.getItem(WEB_REPLAY_MODE_KEY) === 'all' ? 'all' : 'recent';
}

function sessionCursorKey(
  sessionId: string,
  identity: { accountId?: string; userId?: string } | undefined,
  connectionSettings: { relayUrl: string }
): string {
  const accountId = identity?.accountId ?? 'anonymous';
  const userId = identity?.userId ?? 'default-user';
  const gatewayHint = connectionSettings.relayUrl.trim() || 'relay';
  return `tether:${accountId}:${userId}:relay:${gatewayHint}:${sessionId}:latestEventId`;
}

function gatewayRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const authHeaders = gatewayAuthHeaders();
  if (authHeaders) {
    for (const [key, value] of new Headers(authHeaders).entries()) {
      headers.set(key, value);
    }
  }
  return fetch(input, { ...init, headers });
}

function clientModeLabel(mode: ClientMode, t: WebMessages): string {
  return mode === 'observe' ? t.observe : t.control;
}

function displayMessage(message: string, t: WebMessages): string {
  switch (message) {
    case 'authentication failed':
      return t.authFailed;
    case 'gateway is not connected':
      return t.gatewayNotConnected;
    case 'client is not subscribed to this session':
      return t.sessionNotSubscribed;
    case 'observer clients cannot send input':
      return t.observeCannotSend;
    case 'observer clients cannot resize':
      return t.observeCannotResize;
    case 'PTY session is no longer running':
    case 'pty session is no longer running':
    case 'session runner no longer has a live PTY':
      return t.sessionEnded;
    default:
      return message;
  }
}

function agentStatusLabel(status: unknown, t: WebMessages): string | undefined {
  switch (status) {
    case 'idle':
      return t.agentStatusIdle;
    case 'submitted':
      return t.agentStatusSubmitted;
    case 'running':
      return t.agentStatusRunning;
    case 'responding':
      return t.agentStatusResponding;
    case 'done':
      return t.agentStatusDone;
    case 'exited':
    case 'disconnected':
      return t.agentStatusDisconnected;
    default:
      return undefined;
  }
}

function isAgentRuntimeStatus(status: unknown): status is AgentRuntimeStatus {
  return (
    status === 'idle' ||
    status === 'submitted' ||
    status === 'running' ||
    status === 'responding' ||
    status === 'done' ||
    status === 'exited' ||
    status === 'disconnected'
  );
}

function isCssColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 64;
}

function terminalThemeFromPayload(payload: Record<string, unknown>): TerminalThemeOverride | undefined {
  const foreground = isCssColor(payload.foreground) ? payload.foreground.trim() : undefined;
  const background = isCssColor(payload.background) ? payload.background.trim() : undefined;
  const cursor = isCssColor(payload.cursor) ? payload.cursor.trim() : undefined;
  if (!foreground && !background && !cursor) {
    return undefined;
  }
  return { foreground, background, cursor };
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const event = value as { id?: unknown; sessionId?: unknown; type?: unknown; payload?: unknown };
  return (
    typeof event.id === 'number' &&
    typeof event.type === 'string' &&
    (event.sessionId === undefined || typeof event.sessionId === 'string') &&
    Boolean(event.payload) &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
  );
}

function buildTerminalTheme(isDark: boolean, override?: TerminalThemeOverride): ITheme {
  const base = isDark
    ? {
        background: '#0c0e10',
        foreground: '#e8ecef',
        cursor: '#8fd0ff',
        selectionBackground: '#24403a'
      }
    : {
        background: '#f8faf9',
        foreground: '#111817',
        cursor: '#047857',
        selectionBackground: '#d8ede5'
      };
  return {
    ...base,
    ...override
  };
}

export type SessionSurfaceMode = 'control' | 'replay';

export type SessionSurfaceProps = {
  sessionId: string;
  surfaceMode: SessionSurfaceMode;
  connectionSettings: ConnectionSettings;
  onConnectionSettingsChange: (settings: ConnectionSettings) => void;
};

export function SessionSurface({
  sessionId,
  surfaceMode,
  connectionSettings
}: SessionSurfaceProps) {
  const { t } = useI18n();
  const { normalAuth } = useAuth();
  return (
    <RelayClientProvider accessToken={normalAuth?.accessToken} relayUrl={connectionSettings.relayUrl}>
      <TerminalPane
        sessionId={sessionId}
        replayOnly={surfaceMode === 'replay'}
        initialStatus={t.statusConnecting}
        connectionSettings={connectionSettings}
      />
    </RelayClientProvider>
  );
}

export function TerminalPane({
  sessionId,
  replayOnly,
  initialStatus,
  connectionSettings,
  embedded = false
}: {
  sessionId: string;
  replayOnly: boolean;
  initialStatus: string;
  connectionSettings: ConnectionSettings;
  embedded?: boolean;
}) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const { isDark } = useUiPreferences();
  const { acquireSessionSubscription, sendFrame, subscribeClose, subscribeFrame } = useRelayClient();
  const location = useLocation();
  const locationState = location.state as { agentSessionId?: string; provider?: string } | null;
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const terminal = React.useRef<Terminal | undefined>(undefined);
  const [clientMode, setClientMode] = React.useState<ClientMode>(readClientMode);
  const [replayMode, setReplayMode] = React.useState<ReplayMode>(readReplayMode);
  const effectiveClientMode = replayOnly ? 'observe' : clientMode;
  const [isTerminalFullscreen, setTerminalFullscreen] = React.useState(false);
  const [status, setStatus] = React.useState(initialStatus);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = React.useState<AgentRuntimeStatus>('idle');
  const [terminalThemeOverride, setTerminalThemeOverride] = React.useState<TerminalThemeOverride | undefined>();
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(locationState?.agentSessionId);
  const [sessionProvider, setSessionProvider] = React.useState<string | undefined>(locationState?.provider);
  const [isTerminalReady, setTerminalReady] = React.useState(false);
  const [isInputReady, setInputReady] = React.useState(false);
  const [isComposerSending, setComposerSending] = React.useState(false);
  const [text, setText] = React.useState('');
  const cursorKey = React.useMemo(
    () => sessionCursorKey(sessionId, normalAuth?.identity, connectionSettings),
    [connectionSettings, normalAuth?.identity, sessionId]
  );
  const changeClientMode = React.useCallback((mode: ClientMode) => {
    window.localStorage.setItem(WEB_CLIENT_MODE_KEY, mode);
    setClientMode(mode);
  }, []);

  const changeReplayMode = React.useCallback((mode: ReplayMode) => {
    window.localStorage.setItem(WEB_REPLAY_MODE_KEY, mode);
    setReplayMode(mode);
  }, []);

  const sendRelayInput = React.useCallback((data: string): boolean => {
    if (effectiveClientMode === 'observe') {
      setStatus(t.statusObserveCannotInput);
      return false;
    }
    const sent = sendFrame({ type: 'client.input', sessionId, data });
    if (!sent) {
      setStatus(t.statusRelayUnavailable);
      return false;
    }
    return true;
  }, [effectiveClientMode, sendFrame, sessionId, t]);

  const isSessionClosed = agentRuntimeStatus === 'exited' || agentRuntimeStatus === 'disconnected';
  const composerDisabledReason = replayOnly
    ? t.composerDisabledReplay
    : effectiveClientMode === 'observe'
      ? t.composerDisabledObserve
      : isSessionClosed
        ? t.composerDisabledSessionClosed
        : isComposerSending
          ? t.composerDisabledSending
          : undefined;
  const isComposerInputDisabled = Boolean(composerDisabledReason);
  const isComposerSubmitDisabled = isComposerInputDisabled || text.trim().length === 0;
  const composerSubmitTitle = composerDisabledReason ?? (text.trim().length === 0 ? t.composerDisabledEmpty : t.send);
  const composerPlaceholder =
    agentRuntimeStatus === 'submitted' || agentRuntimeStatus === 'running' || agentRuntimeStatus === 'responding'
      ? t.composerPlaceholderThinking
      : t.sendToAgent;
  const isAgentThinking =
    agentRuntimeStatus === 'submitted' || agentRuntimeStatus === 'running' || agentRuntimeStatus === 'responding';

  React.useEffect(() => {
    if (terminal.current) {
      terminal.current.options.theme = buildTerminalTheme(isDark, terminalThemeOverride);
    }
  }, [isDark, terminalThemeOverride]);

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setTerminalFullscreen(document.fullscreenElement === panelRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const submitComposerText = React.useCallback(() => {
    const value = text.trim().replace(/\s*\r?\n\s*/g, ' ');
    if (!value) {
      return;
    }
    if (composerDisabledReason) {
      setStatus(composerDisabledReason);
      return;
    }
    setStatus(t.statusSending);
    setComposerSending(true);
    const send = (async () => {
      const textSent = sendRelayInput(value);
      if (!textSent) {
        return false;
      }
      await wait(COMPOSER_ENTER_DELAY_MS);
      return sendRelayInput(TERMINAL_ENTER);
    })();
    send
      .then((ok) => {
        if (!ok) return;
        setText('');
        setStatus(t.statusRelaySent);
        terminal.current?.scrollToBottom();
        terminal.current?.focus();
      })
      .catch(() => setStatus(t.statusInputFailed))
      .finally(() => setComposerSending(false));
  }, [composerDisabledReason, sendRelayInput, t, text]);

  const sendLine = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitComposerText();
  }, [submitComposerText]);

  React.useEffect(() => {
    const root = terminalRef.current;
    if (!root) {
      return undefined;
    }
    setTerminalReady(false);
    setInputReady(false);

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: buildTerminalTheme(isDark)
    });
    const fitAddon = new FitAddon();
    let lastSize = { cols: 0, rows: 0 };
    let resizeFrame = 0;
    let disposed = false;
    let replayComplete = false;
    let reconnectStopped = false;
    let releaseRelaySubscription: (() => void) | undefined;
    let unsubscribeRelayFrames: (() => void) | undefined;
    let unsubscribeRelayClose: (() => void) | undefined;
    const fitTerminal = () => {
      try {
        fitAddon.fit();
      } catch {
        // xterm fit can run before the embedded workbench pane has measurable dimensions.
      }
    };
    const sendResize = () => {
      if (term.cols === lastSize.cols && term.rows === lastSize.rows) {
        return;
      }
      lastSize = { cols: term.cols, rows: term.rows };
      sendFrame({ type: 'client.resize', sessionId, cols: term.cols, rows: term.rows });
    };
    const fitAndResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        fitTerminal();
        sendResize();
      });
    };
    terminal.current = term;
    term.loadAddon(fitAddon);
    term.open(root);
    fitTerminal();
    sendResize();
    term.focus();
    setTerminalReady(true);
    setStatus(t.statusReplaying);

    let after = 0;
    let replayDoneCursor: number | undefined;
    let replayDoneReceived = false;
    let replayFlushFrame = 0;
    let replayOutputBuffer = '';
    let liveOutputBuffer = '';
    let liveFlushFrame = 0;

    const input = term.onData((data) => {
      if (!disposed && replayComplete) {
        sendRelayInput(data);
      }
    });

    const writeEventNow = (event: SessionEvent) => {
      if (event.id <= after) {
        return;
      }
      window.localStorage.setItem(cursorKey, String(event.id));
      after = Math.max(after, event.id);
      if (event.type === 'agent.status') {
        if (isAgentRuntimeStatus(event.payload.status)) {
          setAgentRuntimeStatus(event.payload.status);
        }
        const label = agentStatusLabel(event.payload.status, t);
        if (label) {
          setStatus(label);
        }
        return;
      }
      if (event.type === 'terminal.theme.detected') {
        const theme = terminalThemeFromPayload(event.payload);
        if (theme) {
          setTerminalThemeOverride(theme);
          term.options.theme = buildTerminalTheme(isDark, theme);
        }
        return;
      }
      if (event.type === 'terminal.output') {
        const data = event.payload.data;
        if (typeof data === 'string') {
          setTerminalReady(true);
          liveOutputBuffer += data;
          if (!liveFlushFrame) {
            liveFlushFrame = window.requestAnimationFrame(() => {
              liveFlushFrame = 0;
              if (liveOutputBuffer) {
                const chunk = liveOutputBuffer;
                liveOutputBuffer = '';
                term.write(chunk, () => term.scrollToBottom());
              }
            });
          }
        }
        return;
      }
      if (event.type === 'session.exited') {
        setAgentRuntimeStatus('exited');
        setStatus(t.statusExited);
      }
    };

    const finishReplayIfReady = () => {
      if (!replayDoneReceived || replayOutputBuffer.length > 0 || replayComplete) {
        return;
      }
      if (typeof replayDoneCursor === 'number') {
        after = Math.max(after, replayDoneCursor);
        window.localStorage.setItem(cursorKey, String(after));
      }
      replayComplete = true;
      setInputReady(true);
      setTerminalReady(true);
      fitTerminal();
      sendResize();
    };

    const flushReplayQueue = () => {
      replayFlushFrame = 0;
      const startedAt = performance.now();
      while (replayOutputBuffer.length > 0 && performance.now() - startedAt < REPLAY_FLUSH_BUDGET_MS) {
        const chunk = replayOutputBuffer.slice(0, REPLAY_FLUSH_MAX_CHARS);
        replayOutputBuffer = replayOutputBuffer.slice(chunk.length);
        setTerminalReady(true);
        term.write(chunk, () => term.scrollToBottom());
      }
      if (replayOutputBuffer.length > 0) {
        replayFlushFrame = window.requestAnimationFrame(flushReplayQueue);
        return;
      }
      finishReplayIfReady();
    };

    const queueReplayEvent = (event: SessionEvent) => {
      if (event.id <= after) {
        return;
      }
      window.localStorage.setItem(cursorKey, String(event.id));
      after = Math.max(after, event.id);
      if (event.type === 'terminal.output') {
        const data = event.payload.data;
        if (typeof data === 'string') {
          replayOutputBuffer += data;
        }
      } else if (event.type === 'terminal.theme.detected') {
        const theme = terminalThemeFromPayload(event.payload);
        if (theme) {
          setTerminalThemeOverride(theme);
          term.options.theme = buildTerminalTheme(isDark, theme);
        }
      } else if (event.type === 'session.exited') {
        setStatus(t.statusExited);
      }
      if (!replayFlushFrame) {
        replayFlushFrame = window.requestAnimationFrame(flushReplayQueue);
      }
    };

    const handleStreamEvent = (event: SessionEvent) => {
      if (replayComplete) {
        writeEventNow(event);
        return;
      }
      queueReplayEvent(event);
    };

    const handleReplayOutput = (data: string, latestEventId: number) => {
      if (replayComplete) {
        if (latestEventId > after) {
          window.localStorage.setItem(cursorKey, String(latestEventId));
          after = latestEventId;
        }
        setTerminalReady(true);
        term.write(data, () => term.scrollToBottom());
        return;
      }
      if (latestEventId <= after && data.length === 0) {
        return;
      }
      if (latestEventId > after) {
        window.localStorage.setItem(cursorKey, String(latestEventId));
        after = latestEventId;
      }
      replayOutputBuffer += data;
      if (!replayFlushFrame) {
        replayFlushFrame = window.requestAnimationFrame(flushReplayQueue);
      }
    };

    const replayEvents = async () => {
      fitTerminal();
      sendResize();
      setStatus(t.statusReplaying);
      const shouldUseRecentReplay = (replayOnly && replayMode === 'recent') || after === 0;
      const fetchReplayPage = async (query: string): Promise<SessionEvent[]> => {
        const response = await gatewayRequest(`/api/server/sessions/${encodeURIComponent(sessionId)}/events?${query}`);
        if (response.status === 401) {
          logoutNormal();
        }
        if (response.status === 404) {
          reconnectStopped = true;
          throw new Error(t.statusSessionDetached);
        }
        if (!response.ok) {
          throw new Error(`events HTTP ${response.status}`);
        }
        const data = await readGatewayData<{ events: SessionEvent[] }>(response);
        return data.events;
      };

      if (after > 0 || shouldUseRecentReplay) {
        const replayQuery = after > 0
          ? `after=${after}&limit=1000`
          : `after=0&tail=${RELAY_INITIAL_EVENT_LIMIT}`;
        const events = await fetchReplayPage(replayQuery);
        // Queue terminal output through the smooth flush pipeline on initial relay load
        // to avoid rapid scroll callbacks causing visual shaking.
        const useQueue = after === 0;
        for (const event of events) {
          if (useQueue) {
            queueReplayEvent(event);
          } else {
            writeEventNow(event);
          }
        }
        if (useQueue) {
          // replayComplete will be set by finishReplayIfReady() once the WS sends
          // replay.done and the replayOutputBuffer has been fully drained.
          return;
        }
      } else {
        let keepLoading = true;
        while (!disposed && keepLoading) {
          const beforePageCursor = after;
          const events = await fetchReplayPage(`after=${after}&limit=${FULL_REPLAY_EVENT_PAGE_LIMIT}`);
          for (const event of events) {
            writeEventNow(event);
          }
          keepLoading = events.length === FULL_REPLAY_EVENT_PAGE_LIMIT && after > beforePageCursor;
        }
      }
      replayComplete = true;
      setInputReady(true);
      setTerminalReady(true);
      fitTerminal();
      sendResize();
    };

    const handleRelayFrame = (frame: RelayFrame) => {
      if (disposed) {
        return;
      }
      if (frame.type === 'client.auth.ok') {
        const clientId = typeof frame.clientId === 'string' ? frame.clientId : undefined;
        setStatus(clientId ? `${t.relayClientStatusPrefix} · ${clientId.slice(0, 8)}` : t.relayClientStatusPrefix);
        return;
      }
      if (frame.type === 'client.auth.failed') {
        logoutNormal();
        setStatus(displayMessage(typeof frame.message === 'string' ? frame.message : 'authentication failed', t));
        return;
      }
      if (frame.type === 'hello') {
        const clientId = typeof frame.clientId === 'string' ? frame.clientId : undefined;
        setStatus(clientId ? `${t.relayClientStatusPrefix} · ${clientId.slice(0, 8)}` : t.relayClientStatusPrefix);
        return;
      }
      if (frame.type === 'error') {
        if (typeof frame.sessionId === 'string' && frame.sessionId !== sessionId) {
          return;
        }
        setStatus(displayMessage(typeof frame.message === 'string' ? frame.message : t.statusStreamError, t));
        return;
      }
      if (frame.type === 'replay.done') {
        if (frame.sessionId !== sessionId) {
          return;
        }
        replayDoneReceived = true;
        replayDoneCursor = typeof frame.latestEventId === 'number' ? frame.latestEventId : undefined;
        finishReplayIfReady();
        return;
      }
      if (frame.type === 'replay.output') {
        if (frame.sessionId !== sessionId) {
          return;
        }
        handleReplayOutput(
          typeof frame.data === 'string' ? frame.data : '',
          typeof frame.latestEventId === 'number' ? frame.latestEventId : after
        );
        return;
      }
      if (frame.type === 'event' && isSessionEvent(frame.event) && (!frame.event.sessionId || frame.event.sessionId === sessionId)) {
        handleStreamEvent(frame.event);
      }
    };

    const connectStream = async () => {
      if (reconnectStopped) {
        throw new Error(t.statusSessionDetached);
      }
      replayComplete = false;
      replayDoneReceived = false;
      replayDoneCursor = undefined;
      replayOutputBuffer = '';
      if (normalAuth?.accessToken) {
        await replayEvents();
      }
      fitTerminal();
      sendResize();
      setStatus(t.statusRelayAuth);
      unsubscribeRelayFrames = subscribeFrame(handleRelayFrame);
      unsubscribeRelayClose = subscribeClose(() => {
        if (disposed || reconnectStopped) {
          return;
        }
        replayComplete = false;
        setInputReady(false);
        setStatus(t.statusReconnecting);
      });
      releaseRelaySubscription = acquireSessionSubscription({
        owner: `terminal:${sessionId}`,
        sessionId,
        after,
        tail: replayOnly && replayMode === 'recent' && after === 0 ? RECENT_REPLAY_EVENT_LIMIT : undefined,
        mode: effectiveClientMode,
        cols: term.cols,
        rows: term.rows
      });
    };
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : t.statusStreamUnavailable);
        setTerminalReady(true);
      }
    });
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(root);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      if (replayFlushFrame) {
        window.cancelAnimationFrame(replayFlushFrame);
      }
      observer.disconnect();
      input.dispose();
      unsubscribeRelayClose?.();
      unsubscribeRelayFrames?.();
      releaseRelaySubscription?.();
      term.dispose();
    };
  }, [
    acquireSessionSubscription,
    cursorKey,
    effectiveClientMode,
    isDark,
    logoutNormal,
    normalAuth?.accessToken,
    replayMode,
    sendFrame,
    sendRelayInput,
    sessionId,
    subscribeClose,
    subscribeFrame,
    t
  ]);

  function stopSession(): void {
    if (effectiveClientMode === 'observe') {
      setStatus(t.statusObserveCannotInput);
      return;
    }
    const sent = sendFrame({ type: 'client.stop', sessionId });
    if (!sent) {
      setStatus(t.statusRelayUnavailable);
      return;
    }
    setStatus(t.statusStopRequested);
  }

  async function toggleTerminalFullscreen(): Promise<void> {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
        return;
      }
      await panel.requestFullscreen();
    } catch {
      setTerminalFullscreen((value) => !value);
    }
  }

  const terminalActions = replayOnly ? (
    <div className="mode-select">
      <Label>{t.replay}</Label>
      <Select value={replayMode} onValueChange={(value) => changeReplayMode(value as ReplayMode)}>
        <SelectTrigger className="connection-select-trigger">
          <SelectValue>{replayMode === 'recent' ? t.replayRecent : t.replayAll}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">{t.replayRecent}</SelectItem>
          <SelectItem value="all">{t.replayAll}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ) : (
    <>
      <div className="mode-select">
        <Label>{t.mode}</Label>
        <Select value={clientMode} onValueChange={(value) => changeClientMode(value as ClientMode)}>
          <SelectTrigger className="connection-select-trigger">
            <SelectValue>{clientModeLabel(clientMode, t)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="control">{t.control}</SelectItem>
            <SelectItem value="observe">{t.observe}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button asChild variant="outline" size="sm" type="button">
        <Link to={`/remote/session/${encodeURIComponent(sessionId)}/replay`}>{t.replay}</Link>
      </Button>
      <Button variant="outline" size="sm" type="button" onClick={() => stopSession()}>
        <Power aria-hidden="true" />
        {t.stop}
      </Button>
    </>
  );

  return (
    <div className={`session-detail-page${embedded ? ' terminal-embedded-page' : ''}`}>
      {!embedded ? (
        <SessionDetailHeader
          sessionId={sessionId}
          status={status}
          provider={sessionProvider}
          agentSessionId={agentSessionId}
        >
          {terminalActions}
        </SessionDetailHeader>
      ) : null}
      <main
        ref={panelRef}
        className={`terminal-shell terminal-panel${isTerminalFullscreen ? ' terminal-panel-fullscreen' : ''}`}
        aria-label={t.terminalSurface}
        onMouseDown={() => terminal.current?.focus()}
      >
        <Button
          className="terminal-fullscreen-toggle"
          variant="outline"
          size="icon"
          type="button"
          aria-label={isTerminalFullscreen ? t.exitTerminalFullscreen : t.enterTerminalFullscreen}
          title={isTerminalFullscreen ? t.exitTerminalFullscreen : t.enterTerminalFullscreen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            void toggleTerminalFullscreen();
          }}
        >
          {isTerminalFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </Button>
        <div ref={terminalRef} className="terminal-host" />
        {!isTerminalReady ? <TerminalSurfaceSkeleton /> : null}
      </main>
      {!replayOnly ? (
        <form className="composer-form" onSubmit={sendLine}>
          <Textarea
            className={`composer-input${isAgentThinking ? ' composer-input-thinking' : ''}`}
            rows={1}
            autoComplete="off"
            placeholder={composerPlaceholder}
            value={text}
            disabled={isComposerInputDisabled}
            title={composerSubmitTitle}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitComposerText();
              }
            }}
          />
          <Button type="submit" disabled={isComposerSubmitDisabled} title={composerSubmitTitle}>{t.send}</Button>
        </form>
      ) : null}
    </div>
  );
}
