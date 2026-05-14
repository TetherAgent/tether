import * as React from 'react';
import { TerminalSquare } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast
} from '@tether/design';
import { PathPicker } from '../workbench/path-picker.js';
import { ComposerSubmitButton } from '../workbench/composer-submit-button.js';
import { useRelayClient, type RelayFrame, type RelaySessionSummary } from '../relay/use-relay-client.js';
import { GatewaySelector } from '../chats/shell/gateway-selector.js';
import type { TerminalProviderId } from './terminal-command-shortcuts.js';

type LaunchMode = 'background' | 'local-terminal';
type PendingLocalLaunch = {
  existingIds: Set<string>;
  gatewayId?: string;
  provider: TerminalProviderId;
};

const PROVIDERS: Array<{ id: TerminalProviderId; label: string }> = [
  { id: 'shell', label: 'Shell' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' }
];

const LAUNCH_MODES: Array<{ id: LaunchMode; label: string }> = [
  { id: 'background', label: '后台启动' },
  { id: 'local-terminal', label: 'Gateway 本机终端' }
];

const PROVIDER_COPY: Record<TerminalProviderId, { command: string }> = {
  shell: {
    command: 'tether run shell'
  },
  claude: {
    command: 'tether run claude'
  },
  codex: {
    command: 'tether run codex'
  }
};

export function TerminalLaunchComposer({
  onCreateStarted,
  provider,
  onProviderChange,
  onCreated
}: {
  onCreateStarted?: () => void;
  provider: TerminalProviderId;
  onProviderChange: (provider: TerminalProviderId) => void;
  onCreated: (sessionId: string) => void;
}) {
  const { createPtySession, gatewayIdsOnline, relaySessions, sendFrame, subscribeFrame, wsReady } = useRelayClient();
  const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
  const [launchMode, setLaunchMode] = React.useState<LaunchMode>('background');
  const [cwd, setCwd] = React.useState('~');
  const [pathPickerOpen, setPathPickerOpen] = React.useState(false);
  const [pathSuggestions, setPathSuggestions] = React.useState<string[]>([]);
  const [pathSuggestionIndex, setPathSuggestionIndex] = React.useState(0);
  const [pathLoading, setPathLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingLocalLaunch, setPendingLocalLaunch] = React.useState<PendingLocalLaunch | undefined>(undefined);

  React.useEffect(() => {
    return subscribeFrame((frame: RelayFrame) => {
      if (frame.type !== 'gateway.cwd-suggestions') return;
      if (typeof frame.cwd === 'string' && frame.cwd !== cwd) return;
      setPathLoading(false);
      setPathSuggestionIndex(0);
      setPathSuggestions(Array.isArray(frame.suggestions) ? frame.suggestions.filter((item): item is string => typeof item === 'string') : []);
    });
  }, [cwd, subscribeFrame]);

  React.useEffect(() => {
    if (!pendingLocalLaunch) return;
    const createdSession = relaySessions.find((session): session is RelaySessionSummary & { id: string } => {
      if (pendingLocalLaunch.existingIds.has(session.id)) return false;
      if (session.transport !== 'pty-event-stream') return false;
      if (session.provider !== pendingLocalLaunch.provider) return false;
      if (pendingLocalLaunch.gatewayId && session.gatewayId !== pendingLocalLaunch.gatewayId) return false;
      return session.status === undefined || session.status === 'running';
    });
    if (!createdSession) return;
    setPendingLocalLaunch(undefined);
    onCreated(createdSession.id);
  }, [onCreated, pendingLocalLaunch, relaySessions]);

  React.useEffect(() => {
    if (!pendingLocalLaunch) return undefined;
    const timer = window.setTimeout(() => {
      setPendingLocalLaunch(undefined);
      toast.error('已打开本机终端，但还没等到新 session。请确认命令启动成功，或从左侧列表进入。');
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, [pendingLocalLaunch]);

  const requestPathSuggestions = React.useCallback((nextCwd: string) => {
    if (!selectedGatewayId) return;
    setPathLoading(true);
    sendFrame({ type: 'client.cwd-suggest', cwd: nextCwd || '~', gatewayId: selectedGatewayId });
  }, [selectedGatewayId, sendFrame]);

  const changeCwd = React.useCallback((nextCwd: string) => {
    setCwd(nextCwd);
    requestPathSuggestions(nextCwd);
  }, [requestPathSuggestions]);

  const isGatewaySelectionPending = wsReady && !selectedGatewayId;
  const disabledReason = !wsReady
    ? 'Relay 未连接'
    : isGatewaySelectionPending
      ? 'Gateway 未连接'
      : selectedGatewayId && !gatewayIdsOnline.has(selectedGatewayId)
        ? 'Gateway 未连接'
      : undefined;
  const visibleDisabledReason = isGatewaySelectionPending ? undefined : disabledReason;
  const busy = submitting || Boolean(pendingLocalLaunch);

  const submit = async () => {
    if (disabledReason || busy) return;
    setSubmitting(true);
    const existingIds = new Set(relaySessions.map((session) => session.id));
    try {
      onCreateStarted?.();
      const result = await createPtySession({
        cwd,
        gatewayId: selectedGatewayId,
        launchMode,
        provider
      });
      if (result.launchMode === 'background') {
        onCreated(result.sessionId);
        return;
      }
      setPendingLocalLaunch({
        existingIds,
        gatewayId: selectedGatewayId,
        provider
      });
      toast.success('已打开 Gateway 本机终端，等待 session 创建后自动跳转。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建终端失败');
    } finally {
      setSubmitting(false);
    }
  };

  const providerCopy = PROVIDER_COPY[provider];

  return (
    <div className="terminal-launch-composer chat-input-card relative overflow-hidden rounded-2xl border border-border bg-card text-left shadow-card">
      <div className="terminal-launch-preview flex min-h-[88px] items-center px-4 py-4">
        <code className="inline-flex rounded-full bg-muted px-3 py-1.5 font-mono text-[12px] font-semibold text-foreground">
          {providerCopy.command}
        </code>
      </div>
      <div className="chat-input-toolbar chat-input-toolbar-controls terminal-launch-toolbar relative flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2.5">
        <Select
          value={provider}
          onValueChange={(value) => {
            if (value === 'shell' || value === 'claude' || value === 'codex') {
              onProviderChange(value);
            }
          }}
        >
          <SelectTrigger className="chat-provider-trigger chat-toolbar-trigger w-auto">
            <SelectValue>{PROVIDERS.find((item) => item.id === provider)?.label ?? 'Shell'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={launchMode}
          onValueChange={(value) => setLaunchMode(value as LaunchMode)}
        >
          <SelectTrigger className="chat-model-trigger chat-toolbar-trigger terminal-launch-mode-trigger w-auto">
            <SelectValue>{LAUNCH_MODES.find((item) => item.id === launchMode)?.label ?? '后台启动'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LAUNCH_MODES.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <GatewaySelector
          selectedGatewayId={selectedGatewayId}
          onSelect={(gatewayId) => setSelectedGatewayId(gatewayId)}
          onlineGatewayIds={gatewayIdsOnline}
        />
        <PathPicker
          activeIndex={pathSuggestionIndex}
          emptyLabel="没有目录建议"
          inputPlaceholder="输入工作目录"
          loading={pathLoading}
          loadingLabel="正在读取目录"
          onActiveIndexChange={setPathSuggestionIndex}
          onOpenChange={(open) => {
            setPathPickerOpen(open);
            if (open) requestPathSuggestions(cwd);
          }}
          onValueChange={changeCwd}
          open={pathPickerOpen}
          selectLabel="目录"
          suggestions={pathSuggestions}
          triggerLabel="目录"
          value={cwd}
        />
        <div className="min-w-0 flex-1" />
        <ComposerSubmitButton
          type="button"
          disabled={!!disabledReason || busy}
          title={disabledReason ?? '启动终端'}
          onClick={() => void submit()}
          loading={busy}
          icon={launchMode === 'local-terminal' ? <TerminalSquare className="h-4 w-4" /> : undefined}
        />
      </div>
      {visibleDisabledReason ? <p className="mt-3 text-center text-xs text-muted-foreground">{visibleDisabledReason}，请先确认连接状态。</p> : null}
    </div>
  );
}
