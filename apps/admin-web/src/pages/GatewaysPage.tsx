import * as React from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { listGateways, unlinkGateway, type AdminGateway } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function GatewayStatusBadge({ status }: { status: 'online' | 'offline' | 'unlinked' }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-green-400 bg-green-400/10">
        在线
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted/40">
        离线
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted/40">
      已取消链接
    </span>
  );
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

  return (
    <div>
      <h1 className="text-lg font-semibold mb-6">Gateway</h1>

      {error && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-destructive text-sm">数据加载失败，请检查网络连接后重试。</p>
          <Button variant="outline" size="sm" onClick={() => fetchGateways(page)}>
            重试
          </Button>
        </div>
      )}

      <div className="rounded-md border">
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
                    <TableCell
                      colSpan={4}
                      className="text-center py-12 text-muted-foreground"
                    >
                      <p className="font-medium">暂无 Gateway</p>
                      <p className="text-xs mt-1">还没有已注册的 Gateway。</p>
                    </TableCell>
                  </TableRow>
                )
              : gateways.map(gateway => (
                  <TableRow key={gateway.id}>
                    <TableCell className="font-mono text-xs">{gateway.id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(gateway.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <GatewayStatusBadge status={gateway.status} />
                    </TableCell>
                    <TableCell>
                      {gateway.status !== 'unlinked' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setConfirmGateway(gateway)}
                        >
                          取消链接
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
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

      <Dialog
        open={!!confirmGateway}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmGateway(null);
            setUnlinkError(null);
          }
        }}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>取消链接 Gateway</DialogTitle>
            <DialogDescription>
              确定取消链接 {confirmGateway?.id}？该 Gateway 将无法再通过 Relay 发布会话。
            </DialogDescription>
          </DialogHeader>
          {unlinkError && (
            <p className="text-sm text-destructive">{unlinkError}</p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={!!unlinking}
              onClick={() => { setConfirmGateway(null); setUnlinkError(null); }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!!unlinking}
              onClick={() => confirmGateway && handleUnlink(confirmGateway)}
            >
              {unlinking ? '取消链接中…' : '确认取消链接'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
