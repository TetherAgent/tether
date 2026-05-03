import * as React from 'react';
import {
  Badge,
  Button,
  InfoBlock,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@tether/design';
import { RadioTower, RefreshCcw, Router, Unplug, Waypoints } from 'lucide-react';
import { AdminEmptyState, AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/AdminPageFrame.js';
import {
  listGateways,
  unlinkGateway,
  type AdminGateway,
} from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function GatewayStatusBadge({ status }: { status: 'online' | 'offline' | 'unlinked' }) {
  if (status === 'online') {
    return <Badge variant="bull">在线</Badge>;
  }
  if (status === 'offline') {
    return <Badge variant="secondary">离线</Badge>;
  }
  return <Badge variant="secondary">已取消链接</Badge>;
}

export function GatewaysPage() {
  const { managementAuth } = useAdminAuth();
  const [gateways, setGateways] = React.useState<AdminGateway[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmGateway, setConfirmGateway] = React.useState<AdminGateway | null>(null);
  const [unlinking, setUnlinking] = React.useState<string | null>(null);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);

  const fetchGateways = React.useCallback(
    (p: number) => {
      if (!managementAuth?.accessToken) return;
      setLoading(true);
      setError(null);
      listGateways(managementAuth.accessToken, p)
        .then(result => {
          setGateways(result.gateways);
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
    fetchGateways(page);
  }, [fetchGateways, page]);

  async function handleUnlink(gateway: AdminGateway) {
    if (!managementAuth?.accessToken) return;
    setUnlinking(gateway.id);
    setUnlinkError(null);
    try {
      await unlinkGateway(managementAuth.accessToken, gateway.id);
      setGateways(current => current.filter(g => g.id !== gateway.id));
      setTotal(t => t - 1);
      setConfirmGateway(null);
    } catch (err: unknown) {
      setUnlinkError('操作失败，请稍后重试。');
    } finally {
      setUnlinking(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onlineCount = gateways.filter((gateway) => gateway.status === 'online').length;
  const offlineCount = gateways.filter((gateway) => gateway.status === 'offline').length;
  const unlinkedCount = gateways.filter((gateway) => gateway.status === 'unlinked').length;

  return (
    <AdminPageFrame
      eyebrow="Gateway"
      title="节点管理"
      description="这里处理的不是静态 ID 列表，而是 Tether 的会话发布节点与控制链路健康度。"
      actions={
        <Button variant="outline" size="sm" onClick={() => fetchGateways(page)}>
          <span className="inline-flex items-center gap-2">
            <RefreshCcw className="size-4" />
            刷新
          </span>
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard label="Gateway 总量" value={loading ? <Skeleton className="h-10 w-20" /> : total} helper="当前工作区已注册节点" tone="brand" icon={Waypoints} />
        <AdminMetricCard label="在线节点" value={loading ? <Skeleton className="h-10 w-20" /> : onlineCount} helper="可继续发布会话的节点" tone="bull" icon={RadioTower} />
        <AdminMetricCard label="离线节点" value={loading ? <Skeleton className="h-10 w-20" /> : offlineCount} helper="暂时未连通的节点" tone="warning" icon={Router} />
        <AdminMetricCard label="已取消链接" value={loading ? <Skeleton className="h-10 w-20" /> : unlinkedCount} helper="已退出会话发布链路" tone="bear" icon={Unplug} />
      </div>

      <AdminPanel
        title="节点链路"
        description="重点看在线性与解绑操作，避免 Relay 发布面失控。"
        count={total}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="default">在线 / 离线状态可见</Badge>
            <Badge variant="secondary">支持直接取消链接</Badge>
          </div>
        }
      >
        {error ? (
          <AdminEmptyState
            title="Gateway 数据暂时不可用"
            description="先恢复管理 API，再回来判断哪些节点失联或需要解绑。"
            action={<Button onClick={() => fetchGateways(page)}>重新加载</Button>}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Gateway ID</TableHead>
                    <TableHead className="text-xs font-semibold">最后认证时间</TableHead>
                    <TableHead className="text-xs font-semibold">在线状态</TableHead>
                    <TableHead className="text-xs font-semibold">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 4 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : gateways.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={4} className="p-0">
                            <AdminEmptyState
                              title="还没有 Gateway"
                              description="没有节点被注册进后台时，移动端或远端客户端就没有稳定的会话承载点。"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    : gateways.map((gateway) => (
                        <TableRow key={gateway.id}>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <div className="font-mono text-xs text-foreground">{gateway.id}</div>
                              <div className="text-xs text-muted-foreground">会话发布节点</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(gateway.lastSeenAt)}</TableCell>
                          <TableCell><GatewayStatusBadge status={gateway.status} /></TableCell>
                          <TableCell>
                            {gateway.status !== 'unlinked' ? (
                              <Button variant="destructive" size="sm" onClick={() => setConfirmGateway(gateway)}>
                                取消链接
                              </Button>
                            ) : (
                              <Badge variant="secondary">已移除</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            {!loading && total > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                <span>第 {page} 页，共 {total} 个 Gateway</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </AdminPanel>

      <Dialog
        open={!!confirmGateway}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmGateway(null);
            setUnlinkError(null);
          }
        }}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>取消链接 Gateway</DialogTitle>
            <DialogDescription>
              确定取消链接 {confirmGateway?.id}？该节点将退出 Relay 发布链路。
            </DialogDescription>
          </DialogHeader>
          {unlinkError ? <InfoBlock variant="error" title="取消链接失败" description={unlinkError} /> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={!!unlinking} onClick={() => { setConfirmGateway(null); setUnlinkError(null); }}>
              取消
            </Button>
            <Button variant="destructive" disabled={!!unlinking} onClick={() => confirmGateway && handleUnlink(confirmGateway)}>
              {unlinking ? '取消链接中…' : '确认取消链接'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageFrame>
  );
}
