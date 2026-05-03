import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
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

  return (
    <div>
      <h1 className="text-lg font-semibold mb-6">审计日志</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Input
          placeholder="用户邮箱"
          value={filterUserId}
          onChange={e => setFilterUserId(e.target.value)}
          className="w-48"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <Input
          placeholder="操作类型（如 auth.login.success）"
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="w-56"
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <Input
          type="date"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
          className="w-40"
        />
        <Input
          type="date"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
          className="w-40"
        />
        <Button onClick={handleSearch} size="sm">查询</Button>
        <Button variant="outline" size="sm" onClick={handleReset}>重置</Button>
      </div>

      {error && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-destructive text-sm">数据加载失败，请检查网络连接后重试。</p>
          <Button variant="outline" size="sm" onClick={handleSearch}>
            重试
          </Button>
        </div>
      )}

      <div className="rounded-md border">
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
                    <TableCell
                      colSpan={6}
                      className="text-center py-12 text-muted-foreground"
                    >
                      <p className="font-medium">暂无审计记录</p>
                      <p className="text-xs mt-1">符合筛选条件的审计事件为空。</p>
                    </TableCell>
                  </TableRow>
                )
              : events.map(event => (
                  <React.Fragment key={event.id}>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.userId ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono text-xs">
                        {event.deviceId ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono text-xs">
                        {event.gatewayId ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {event.action}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpand(event.id)}
                        >
                          {expandedIds.has(event.id) ? '收起' : '展开'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedIds.has(event.id) && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0">
                          <pre className="p-4 text-xs font-mono bg-muted/40 rounded overflow-x-auto whitespace-pre-wrap">
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

      {!loading && total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>
            第 {page} 页，共 {total} 条
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
