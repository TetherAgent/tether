import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { AlertCircle, Check, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';
import type { ApprovalDecision, ApprovalRequest } from '@tether/protocol';

import type { WorkbenchOutletContext } from '../components/workbench/workbench-layout.js';
import { WorkbenchConnectionStatus } from '../components/workbench/workbench-status-pill.js';
import { WorkbenchTopbar } from '../components/workbench/workbench-topbar.js';
import { useRelayClient } from '../components/relay/use-relay-client.js';
import { useI18n } from '../hooks/use-i18n.js';
import { decideApproval, listApprovals } from '../lib/api.js';

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function riskClass(risk: ApprovalRequest['risk']): string {
  if (risk === 'critical') return 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300';
  if (risk === 'high') return 'border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-300';
  if (risk === 'medium') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

function previewText(approval: ApprovalRequest): string {
  if (!approval.inputPreview) return '{}';
  try {
    return JSON.stringify(approval.inputPreview, null, 2);
  } catch {
    return '{}';
  }
}

function isApprovalUpdatedFrame(frame: Record<string, unknown>): frame is { type: 'approval.updated'; approval: ApprovalRequest } {
  return frame.type === 'approval.updated' && Boolean(frame.approval && typeof frame.approval === 'object');
}

export function ApprovalsPage() {
  const { onExpandSidebar, onOpenDrawer } = useOutletContext<WorkbenchOutletContext>();
  const { t } = useI18n();
  const { sendFrame, subscribeFrame, wsReady } = useRelayClient();
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const [decidingId, setDecidingId] = React.useState<string | undefined>();

  const loadApprovals = React.useCallback(async () => {
    setError(undefined);
    try {
      const pending = await listApprovals({ status: 'pending' });
      setApprovals(pending);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.approvalsLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.approvalsLoadFailed]);

  React.useEffect(() => {
    void loadApprovals();
    const timer = window.setInterval(() => void loadApprovals(), 5000);
    return () => window.clearInterval(timer);
  }, [loadApprovals]);

  React.useEffect(() => subscribeFrame((frame) => {
    if (!isApprovalUpdatedFrame(frame)) return;
    setApprovals((current) => {
      const next = current.filter((approval) => approval.id !== frame.approval.id);
      return frame.approval.status === 'pending'
        ? [frame.approval, ...next]
        : next;
    });
  }), [subscribeFrame]);

  const decide = React.useCallback(async (approval: ApprovalRequest, decision: ApprovalDecision) => {
    if (!wsReady) {
      setError(t.approvalsRelayRequired);
      return;
    }
    setDecidingId(approval.id);
    setError(undefined);
    try {
      const updated = await decideApproval({ approvalId: approval.id, decision });
      const sent = sendFrame({
        type: 'client.permission_response',
        sessionId: updated.sessionId,
        requestId: updated.requestId,
        decision
      });
      if (!sent) {
        setError(t.approvalsRelayRequired);
        await loadApprovals();
        return;
      }
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : t.approvalsDecisionFailed);
      await loadApprovals();
    } finally {
      setDecidingId(undefined);
    }
  }, [loadApprovals, sendFrame, t.approvalsDecisionFailed, t.approvalsRelayRequired, wsReady]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <WorkbenchTopbar
        help={{ label: t.helpNavLabel }}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
      >
        <WorkbenchConnectionStatus />
      </WorkbenchTopbar>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4" />
                {t.approvalsEyebrow}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {t.approvalsTitle}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {t.approvalsDescription}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadApprovals()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.approvalsRefresh}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
              {t.statusLoading}
            </div>
          ) : approvals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <Check className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-medium text-foreground">{t.approvalsEmptyTitle}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t.approvalsEmptyBody}</div>
            </div>
          ) : (
            <div className="grid gap-3">
              {approvals.map((approval) => (
                <Card key={approval.id} className="overflow-hidden">
                  <CardHeader className="gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{approval.title}</CardTitle>
                        <CardDescription className="mt-1">
                          {approval.summary}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className={riskClass(approval.risk)}>
                        {approval.risk}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                      <div><span className="text-foreground">{t.approvalsTool}</span> {approval.toolName ?? '-'}</div>
                      <div><span className="text-foreground">{t.sessionIdLabel}</span> {approval.sessionId.slice(0, 12)}</div>
                      <div><span className="text-foreground">{t.approvalsCreated}</span> {formatTime(approval.createdAt)}</div>
                    </div>
                    <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-muted/30 p-3 text-xs leading-5 text-foreground">
                      {previewText(approval)}
                    </pre>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={decidingId === approval.id}
                        onClick={() => void decide(approval, 'deny')}
                      >
                        <X className="mr-2 h-4 w-4" />
                        {t.chatsPermissionDeny}
                      </Button>
                      <Button
                        size="sm"
                        disabled={decidingId === approval.id}
                        onClick={() => void decide(approval, 'allow')}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        {t.chatsPermissionAllow}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
