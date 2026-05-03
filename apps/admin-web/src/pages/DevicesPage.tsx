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
import { listDevices, revokeDevice, type AdminDevice } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function StatusBadge({ status }: { status: 'active' | 'revoked' }) {
  if (status === 'revoked') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-destructive bg-destructive/10">
        已吊销
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-green-400 bg-green-400/10">
      在线
    </span>
  );
}

export function DevicesPage() {
  const { managementAuth } = useAdminAuth();
  const [devices, setDevices] = React.useState<AdminDevice[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDevice, setConfirmDevice] = React.useState<AdminDevice | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);

  const fetchDevices = React.useCallback(
    (p: number) => {
      if (!managementAuth?.accessToken) return;
      setLoading(true);
      setError(null);
      listDevices(managementAuth.accessToken, p)
        .then(result => {
          setDevices(result.devices);
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
    fetchDevices(page);
  }, [fetchDevices, page]);

  async function handleRevoke(device: AdminDevice) {
    if (!managementAuth?.accessToken) return;
    setRevoking(device.id);
    setRevokeError(null);
    try {
      await revokeDevice(managementAuth.accessToken, device.id);
      setDevices(current =>
        current.map(d => d.id === device.id ? { ...d, status: 'revoked' as const } : d)
      );
      setConfirmDevice(null);
    } catch (err: unknown) {
      setRevokeError('操作失败，请稍后重试。');
    } finally {
      setRevoking(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-lg font-semibold mb-6">设备</h1>

      {error && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-destructive text-sm">数据加载失败，请检查网络连接后重试。</p>
          <Button variant="outline" size="sm" onClick={() => fetchDevices(page)}>
            重试
          </Button>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold">设备名</TableHead>
              <TableHead className="text-xs font-semibold">类型</TableHead>
              <TableHead className="text-xs font-semibold">所属用户</TableHead>
              <TableHead className="text-xs font-semibold">在线状态</TableHead>
              <TableHead className="text-xs font-semibold">最后在线时间</TableHead>
              <TableHead className="text-xs font-semibold">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : devices.length === 0
              ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-12 text-muted-foreground"
                    >
                      <p className="font-medium">暂无设备</p>
                      <p className="text-xs mt-1">该用户还没有注册设备。</p>
                    </TableCell>
                  </TableRow>
                )
              : devices.map(device => (
                  <TableRow key={device.id}>
                    <TableCell className="text-sm">{device.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{device.platform}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {device.userEmail ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={device.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(device.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      {device.status === 'active'
                        ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setConfirmDevice(device)}
                            >
                              吊销
                            </Button>
                          )
                        : (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-destructive bg-destructive/10">
                              已吊销
                            </span>
                          )
                      }
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
        open={!!confirmDevice}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDevice(null);
            setRevokeError(null);
          }
        }}
      >
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>吊销设备</DialogTitle>
            <DialogDescription>
              确定吊销设备 {confirmDevice?.name}？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive">{revokeError}</p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={!!revoking}
              onClick={() => { setConfirmDevice(null); setRevokeError(null); }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!!revoking}
              onClick={() => confirmDevice && handleRevoke(confirmDevice)}
            >
              {revoking ? '吊销中…' : '确认吊销'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
