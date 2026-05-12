import * as React from 'react';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tether/design';
import { Activity, MessageSquare, RefreshCcw, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdminEmptyState, AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/admin-page-frame.js';
import { listSessions, type AdminSession } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function TransportBadge({ transport }: { transport: string }) {
  if (transport === 'chat') return <Badge variant="info">Chat</Badge>;
  if (transport === 'tmux') return <Badge variant="secondary">tmux</Badge>;
  return <Badge variant="secondary">pty</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'running') return <Badge variant="bull">运行中</Badge>;
  if (status === 'completed') return <Badge variant="default">已完成</Badge>;
  if (status === 'failed') return <Badge variant="destructive">失败</Badge>;
  if (status === 'lost') return <Badge variant="warning">丢失</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export function SessionsPage() {
  const { managementAuth } = useAdminAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = React.useState<AdminSession[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [filterUserId, setFilterUserId] = React.useState('');
  const [filterGatewayId, setFilterGatewayId] = React.useState('');
  const [filterTransport, setFilterTransport] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState('');

  const [appliedFilters, setAppliedFilters] = React.useState({
    userId: '', gatewayId: '', transport: '', status: '',
  });

  const fetchSessions = React.useCallback(
    (p: number, filters: typeof appliedFilters) => {
      if (!managementAuth?.accessToken) return;
      setLoading(true);
      setError(null);
      listSessions(managementAuth.accessToken, {
        page: p,
        limit: PAGE_SIZE,
        userId: filters.userId || undefined,
        gatewayId: filters.gatewayId || undefined,
        transport: filters.transport || undefined,
        status: filters.status || undefined,
      })
        .then(result => {
          setSessions(result.sessions);
          setTotal(result.total);
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : 'load_failed')
        )
        .finally(() => setLoading(false));
    },
    [managementAuth]
  );

  React.useEffect(() => {
    fetchSessions(page, appliedFilters);
  }, [fetchSessions, page, appliedFilters]);

  function handleSearch() {
    setPage(1);
    setAppliedFilters({ userId: filterUserId, gatewayId: filterGatewayId, transport: filterTransport, status: filterStatus });
  }

  function handleReset() {
    setFilterUserId(''); setFilterGatewayId(''); setFilterTransport(''); setFilterStatus('');
    setPage(1);
    setAppliedFilters({ userId: '', gatewayId: '', transport: '', status: '' });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chatCount = sessions.filter(s => s.transport === 'chat').length;
  const runningCount = sessions.filter(s => s.status === 'running').length;
  const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;

  return (
    <AdminPageFrame
      eyebrow="Sessions"
      title="会话管理"
      description="查看所有 Gateway 上产生的会话记录，可以按传输类型、状态和归属筛查，再下钻到具体消息或事件流。"
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">{activeFilterCount > 0 ? `${activeFilterCount} 个筛选器生效中` : '未启用筛选器'}</Badge>
          <Button variant="outline" size="sm" onClick={() => fetchSessions(page, appliedFilters)}>
            <span className="inline-flex items-center gap-2">
              <RefreshCcw className="size-4" />
              刷新
            </span>
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard label="会话总数" value={loading ? <Skeleton className="h-10 w-20" /> : total} helper="当前筛选条件下的会话量" tone="brand" icon={Activity} />
        <AdminMetricCard label="运行中" value={loading ? <Skeleton className="h-10 w-20" /> : runningCount} helper="当前页仍在活跃的会话" tone="bull" icon={Activity} />
        <AdminMetricCard label="Chat 会话" value={loading ? <Skeleton className="h-10 w-20" /> : chatCount} helper="当前页 transport=chat 的会话数" tone="default" icon={MessageSquare} />
        <AdminMetricCard label="PTY 会话" value={loading ? <Skeleton className="h-10 w-20" /> : sessions.length - chatCount} helper="当前页终端类会话数" tone="warning" icon={Terminal} />
      </div>

      <AdminPanel
        title="会话清单"
        description="先看 transport 和 status，再决定是否下钻查消息或事件流。"
        count={total}
        toolbar={
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.6fr_0.6fr_auto_auto]">
            <Input
              placeholder="用户 ID"
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
              className="h-11"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Input
              placeholder="Gateway ID"
              value={filterGatewayId}
              onChange={e => setFilterGatewayId(e.target.value)}
              className="h-11"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Select value={filterTransport} onValueChange={setFilterTransport}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="传输类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部</SelectItem>
                <SelectItem value="chat">chat</SelectItem>
                <SelectItem value="pty-event-stream">pty</SelectItem>
                <SelectItem value="tmux">tmux</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部</SelectItem>
                <SelectItem value="running">running</SelectItem>
                <SelectItem value="completed">completed</SelectItem>
                <SelectItem value="stopped">stopped</SelectItem>
                <SelectItem value="failed">failed</SelectItem>
                <SelectItem value="lost">lost</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} className="h-11">查询</Button>
            <Button variant="outline" onClick={handleReset} className="h-11">重置</Button>
          </div>
        }
      >
        {error ? (
          <AdminEmptyState
            title="会话数据暂时不可用"
            description="请检查后台 API 或认证状态后重试。"
            action={<Button onClick={() => fetchSessions(page, appliedFilters)}>重新加载</Button>}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">会话</TableHead>
                    <TableHead className="text-xs font-semibold">类型 / 状态</TableHead>
                    <TableHead className="text-xs font-semibold">归属</TableHead>
                    <TableHead className="text-xs font-semibold">Provider</TableHead>
                    <TableHead className="text-xs font-semibold">最后活跃</TableHead>
                    <TableHead className="text-xs font-semibold">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    : sessions.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={6} className="p-0">
                            <AdminEmptyState
                              title="没有符合条件的会话"
                              description="调整筛选条件，或等待 Gateway 上报新的会话记录。"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    : sessions.map(session => (
                        <TableRow key={session.id}>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-foreground">
                                {session.title ?? '未命名会话'}
                              </div>
                              <div className="font-mono text-xs text-muted-foreground">{session.id}</div>
                              {session.projectPath ? (
                                <div className="max-w-[200px] truncate text-xs text-muted-foreground">{session.projectPath}</div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-wrap gap-1.5">
                              <TransportBadge transport={session.transport} />
                              <StatusBadge status={session.status} />
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <div className="text-sm text-foreground">{session.userEmail ?? '—'}</div>
                              <div className="font-mono text-xs text-muted-foreground">GW {session.gatewayId.slice(0, 8)}…</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{session.provider}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(session.lastActiveAt)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/admin/sessions/${encodeURIComponent(session.id)}`)}
                            >
                              查看详情
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            {!loading && total > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                <span>第 {page} 页，共 {total} 条会话记录</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </AdminPanel>
    </AdminPageFrame>
  );
}
