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
import { Radio, RefreshCcw, Shield, ShieldBan, Smartphone } from 'lucide-react';
import { AdminEmptyState, AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/admin-page-frame.js';
import {
  listDevices,
  revokeDevice,
  type AdminDevice,
} from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

function StatusBadge({ status }: { status: 'active' | 'revoked' }) {
  if (status === 'revoked') {
    return <Badge variant="destructive">已吊销</Badge>;
  }
  return <Badge variant="bull">在线</Badge>;
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
  const activeDevices = devices.filter((device) => device.status === 'active').length;
  const revokedDevices = devices.filter((device) => device.status === 'revoked').length;
  const assignedDevices = devices.filter((device) => device.userEmail).length;

  return (
    <AdminPageFrame
      eyebrow="Access"
      title="设备管理"
      description="设备页不是单纯终端名单，而是接入风险面。重点看当前在线、已吊销和是否绑定到有效用户。"
      actions={
        <Button variant="outline" size="sm" onClick={() => fetchDevices(page)}>
          <span className="inline-flex items-center gap-2">
            <RefreshCcw className="size-4" />
            刷新
          </span>
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard label="设备总量" value={loading ? <Skeleton className="h-10 w-20" /> : total} helper="当前工作区已注册终端" tone="brand" icon={Smartphone} />
        <AdminMetricCard label="在线设备" value={loading ? <Skeleton className="h-10 w-20" /> : activeDevices} helper="当前页可继续接入的终端" tone="bull" icon={Radio} />
        <AdminMetricCard label="已吊销" value={loading ? <Skeleton className="h-10 w-20" /> : revokedDevices} helper="已经被后台封禁的终端" tone="bear" icon={ShieldBan} />
        <AdminMetricCard label="已绑定用户" value={loading ? <Skeleton className="h-10 w-20" /> : assignedDevices} helper="身份链路完整的终端" tone="default" icon={Shield} />
      </div>

      <AdminPanel
        title="终端接入面"
        description="看到异常设备时，直接在这里执行吊销，而不是先绕去别的页面。"
        count={total}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="default">支持直接吊销</Badge>
            <Badge variant="secondary">展示用户归属</Badge>
            <Badge variant="secondary">最后在线可见</Badge>
          </div>
        }
      >
        {error ? (
          <AdminEmptyState
            title="设备列表暂时拉不下来"
            description="先恢复后台连接，再回来处理接入面风险。"
            action={<Button onClick={() => fetchDevices(page)}>重新加载</Button>}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
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
                          <TableCell colSpan={6} className="p-0">
                            <AdminEmptyState
                              title="还没有设备"
                              description="没有设备接入时，后台就无法建立有效的终端控制和吊销闭环。"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    : devices.map((device) => (
                        <TableRow key={device.id}>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-foreground">{device.name}</div>
                              <div className="text-xs text-muted-foreground">{device.id}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{device.platform}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{device.userEmail ?? '—'}</TableCell>
                          <TableCell><StatusBadge status={device.status} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(device.lastSeenAt)}</TableCell>
                          <TableCell>
                            {device.status === 'active' ? (
                              <Button variant="destructive" size="sm" onClick={() => setConfirmDevice(device)}>
                                吊销
                              </Button>
                            ) : (
                              <Badge variant="destructive">已吊销</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            {!loading && total > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                <span>第 {page} 页，共 {total} 台设备</span>
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
        open={!!confirmDevice}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDevice(null);
            setRevokeError(null);
          }
        }}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>吊销设备</DialogTitle>
            <DialogDescription>
              确定吊销设备 {confirmDevice?.name}？此操作会立即切断该终端的后台访问资格。
            </DialogDescription>
          </DialogHeader>
          {revokeError ? <InfoBlock variant="error" title="吊销失败" description={revokeError} /> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={!!revoking} onClick={() => { setConfirmDevice(null); setRevokeError(null); }}>
              取消
            </Button>
            <Button variant="destructive" disabled={!!revoking} onClick={() => confirmDevice && handleRevoke(confirmDevice)}>
              {revoking ? '吊销中…' : '确认吊销'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageFrame>
  );
}
