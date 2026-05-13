import * as React from 'react';
import { ArrowUp, Loader2, TerminalSquare } from 'lucide-react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast
} from '@tether/design';
import { PathPicker } from '../workbench/path-picker.js';
import { useRelayClient, type RelayFrame } from '../relay/use-relay-client.js';
import { GatewaySelector } from '../chats/gateway-selector.js';
import type { TerminalProviderId } from './terminal-command-shortcuts.js';

type LaunchMode = 'background' | 'local-terminal';

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
  provider,
  onProviderChange,
  onCreated
}: {
  provider: TerminalProviderId;
  onProviderChange: (provider: TerminalProviderId) => void;
  onCreated: (sessionId: string) => void;
}) {
  const { createPtySession, gatewayIdsOnline, sendFrame, subscribeFrame, wsReady } = useRelayClient();
  const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
  const [launchMode, setLaunchMode] = React.useState<LaunchMode>('background');
  const [cwd, setCwd] = React.useState('~');
  const [pathPickerOpen, setPathPickerOpen] = React.useState(false);
  const [pathSuggestions, setPathSuggestions] = React.useState<string[]>([]);
  const [pathSuggestionIndex, setPathSuggestionIndex] = React.useState(0);
  const [pathLoading, setPathLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    return subscribeFrame((frame: RelayFrame) => {
      if (frame.type !== 'gateway.cwd-suggestions') return;
      if (typeof frame.cwd === 'string' && frame.cwd !== cwd) return;
      setPathLoading(false);
      setPathSuggestionIndex(0);
      setPathSuggestions(Array.isArray(frame.suggestions) ? frame.suggestions.filter((item): item is string => typeof item === 'string') : []);
    });
  }, [cwd, subscribeFrame]);

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

  const submit = async () => {
    if (disabledReason || submitting) return;
    setSubmitting(true);
    try {
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
      toast.success('已在 Gateway 本机终端打开，session 创建后会出现在左侧列表。');
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
      <div className="chat-input-toolbar terminal-launch-toolbar relative flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2.5">
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
          <SelectTrigger className="chat-toolbar-trigger terminal-launch-mode-trigger w-auto">
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
        <Button
          type="button"
          size="icon"
          variant="brand"
          disabled={!!disabledReason || submitting}
          title={disabledReason ?? '启动终端'}
          onClick={() => void submit()}
          className="terminal-launch-submit h-10 w-10 rounded-full"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : launchMode === 'local-terminal' ? <TerminalSquare className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
      {visibleDisabledReason ? <p className="mt-3 text-center text-xs text-muted-foreground">{visibleDisabledReason}，请先确认连接状态。</p> : null}
    </div>
  );
}
