import * as React from 'react';
import { Badge, Button, DatePicker, Empty, InfoBlock, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tether/design';
import { Activity, Filter, RefreshCcw, SearchCheck, ShieldAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/admin-page-frame.js';
import { listAuditEvents, type AdminAuditEvent } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 50;

interface AppliedFilters {
  userId: string;
  action: string;
  from: string;
  to: string;
}

export function AuditPage() {
  const { managementAuth } = useAdminAuth();
  const [searchParams] = useSearchParams();

  const [events, setEvents] = React.useState<AdminAuditEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set());

  // Filter input state
  const [filterUserId, setFilterUserId] = React.useState(
    () => searchParams.get('userId') ?? ''
  );
  const [filterAction, setFilterAction] = React.useState('');
  const [filterFrom, setFilterFrom] = React.useState('');
  const [filterTo, setFilterTo] = React.useState('');

  // Applied filters (triggers fetch)
  const [appliedFilters, setAppliedFilters] = React.useState<AppliedFilters>(
    () => ({
      userId: searchParams.get('userId') ?? '',
      action: '',
      from: '',
      to: '',
    })
  );

  React.useEffect(() => {
    if (!managementAuth?.accessToken) return;
    setLoading(true);
    setError(null);
    listAuditEvents(managementAuth.accessToken, {
      page,
      limit: PAGE_SIZE,
      userId: appliedFilters.userId || undefined,
      action: appliedFilters.action || undefined,
      from: appliedFilters.from || undefined,
      to: appliedFilters.to || undefined,
    })
      .then(result => {
        setEvents(result.events);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'load_failed')
      )
      .finally(() => setLoading(false));
  }, [managementAuth, page, appliedFilters]);

  function handleSearch() {
    setPage(1);
    setAppliedFilters({
      userId: filterUserId,
      action: filterAction,
      from: filterFrom,
      to: filterTo,
    });
  }

  function handleReset() {
    setFilterUserId('');
    setFilterAction('');
    setFilterFrom('');
    setFilterTo('');
    setPage(1);
    setAppliedFilters({ userId: '', action: '', from: '', to: '' });
  }

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = [appliedFilters.userId, appliedFilters.action, appliedFilters.from, appliedFilters.to].filter(Boolean).length;
  const authEventCount = events.filter((event) => event.action.startsWith('auth.')).length;

  return (
    <AdminPageFrame
      eyebrow="Forensics"
      title="审计日志"
      description="审计页不是原始 JSON 堆栈，而是问题回放入口。先缩小范围，再展开具体 payload。"
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="default">{activeFilterCount > 0 ? `${activeFilterCount} 个筛选器生效中` : '未启用筛选器'}</Badge>
          <Button variant="outline" size="sm" onClick={handleSearch}>
            <span className="inline-flex items-center gap-2">
              <RefreshCcw className="size-4" />
              刷新
            </span>
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard label="结果总数" value={loading ? <Skeleton className="h-10 w-20" /> : total} helper="当前筛选条件下的事件量" tone="brand" icon={Activity} />
        <AdminMetricCard label="已展开事件" value={expandedIds.size} helper="当前正在查看 payload 的事件" tone="default" icon={SearchCheck} />
        <AdminMetricCard label="认证类事件" value={loading ? <Skeleton className="h-10 w-20" /> : authEventCount} helper="当前页 action 以 auth. 开头" tone="warning" icon={ShieldAlert} />
        <AdminMetricCard label="筛选器" value={activeFilterCount} helper="用于压缩取证范围" tone="bull" icon={Filter} />
      </div>

      <AdminPanel
        title="事件筛查"
        description="先限定用户、动作和时间区间，再决定是否展开 payload 取证。"
        count={total}
        toolbar={
          <div className="grid gap-3 lg:grid-cols-[1.1fr_1.3fr_0.9fr_0.9fr_auto_auto]">
            <Input
              placeholder="用户邮箱"
              value={filterUserId}
              onChange={e => setFilterUserId(e.target.value)}
              className="h-11"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Input
              placeholder="操作类型（如 auth.login.success）"
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="h-11"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <DatePicker
              value={filterFrom}
              onChange={setFilterFrom}
              className="h-11 rounded-xl"
              placeholder="开始日期"
            />
            <DatePicker
              value={filterTo}
              onChange={setFilterTo}
              className="h-11 rounded-xl"
              placeholder="结束日期"
            />
            <Button onClick={handleSearch} className="h-11">查询</Button>
            <Button variant="outline" onClick={handleReset} className="h-11">重置</Button>
          </div>
        }
      >
        {error ? (
          <InfoBlock variant="error" title="审计数据加载失败" description="请检查后台 API 或认证状态后重试。" />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">时间</TableHead>
                    <TableHead className="text-xs font-semibold">用户</TableHead>
                    <TableHead className="text-xs font-semibold">设备</TableHead>
                    <TableHead className="text-xs font-semibold">Gateway</TableHead>
                    <TableHead className="text-xs font-semibold">操作类型</TableHead>
                    <TableHead className="text-xs font-semibold">详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 6 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : events.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={6} className="p-0">
                            <Empty variant="card" className="min-h-[260px] border-0 bg-transparent">
                              <div className="space-y-2">
                                <div className="text-lg font-semibold text-foreground">没有符合条件的审计事件</div>
                                <p className="text-sm text-muted-foreground">换一个时间窗口或动作类型，再继续筛查。</p>
                              </div>
                            </Empty>
                          </TableCell>
                        </TableRow>
                      )
                    : events.map(event => (
                        <React.Fragment key={event.id}>
                          <TableRow>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{event.userId ?? '—'}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{event.deviceId ?? '—'}</TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">{event.gatewayId ?? '—'}</TableCell>
                            <TableCell className="text-sm">
                              {event.action.startsWith('auth.') ? <Badge variant="warning">{event.action}</Badge> : <Badge variant="secondary">{event.action}</Badge>}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => toggleExpand(event.id)}>
                                {expandedIds.has(event.id) ? '收起' : '展开'}
                              </Button>
                            </TableCell>
                          </TableRow>
                          {expandedIds.has(event.id) && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/10 p-4">
                                <pre className="overflow-x-auto rounded-2xl border border-border/60 bg-background p-4 text-xs whitespace-pre-wrap text-foreground">
                                  {JSON.stringify(event.payload, null, 2)}
                                </pre>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                </TableBody>
              </Table>
            </div>

            {!loading && total > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                <span>第 {page} 页，共 {total} 条审计事件</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </AdminPanel>
    </AdminPageFrame>
  );
}
