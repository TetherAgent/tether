import * as React from 'react';
import { Badge, Button, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@tether/design';
import { ArrowRight, RefreshCcw, ShieldAlert, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdminEmptyState, AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/admin-page-frame.js';
import { listUsers, type AdminUser } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

const PAGE_SIZE = 20;

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

export function UsersPage() {
  const { managementAuth } = useAdminAuth();
  const navigate = useNavigate();
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchUsers = React.useCallback(
    (p: number) => {
      if (!managementAuth?.accessToken) return;
      setLoading(true);
      setError(null);
      listUsers(managementAuth.accessToken, p)
        .then(result => {
          setUsers(result.users);
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
    fetchUsers(page);
  }, [fetchUsers, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const totalLoginCount = users.reduce((sum, user) => sum + user.loginCount, 0);
  const riskyUsers = users.filter((user) => user.failedLoginCount > 0).length;
  const activeDeviceCount = users.reduce((sum, user) => sum + user.activeDeviceCount, 0);

  return (
    <AdminPageFrame
      eyebrow="Identity"
      title="用户管理"
      description="这里不是账号列表堆叠页，而是身份质量面板。先看活跃度、失败率和设备承载，再决定是否深挖审计。"
      actions={
        <>
          <Badge variant="secondary">Page {page}</Badge>
          <Button variant="outline" size="sm" onClick={() => fetchUsers(page)}>
            <span className="inline-flex items-center gap-2">
              <RefreshCcw className="size-4" />
              刷新
            </span>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard label="总用户数" value={loading ? <Skeleton className="h-10 w-20" /> : total} helper="已注册身份规模" tone="brand" icon={Users} />
        <AdminMetricCard label="当前页登录次数" value={loading ? <Skeleton className="h-10 w-20" /> : totalLoginCount} helper="用于判断活跃密度" tone="default" icon={ArrowRight} />
        <AdminMetricCard label="风险用户" value={loading ? <Skeleton className="h-10 w-20" /> : riskyUsers} helper="当前页登录失败次数 > 0" tone="bear" icon={ShieldAlert} />
        <AdminMetricCard label="活跃设备承载" value={loading ? <Skeleton className="h-10 w-20" /> : activeDeviceCount} helper="当前页用户关联的活跃终端" tone="bull" icon={Users} />
      </div>

      <AdminPanel
        title="身份清单"
        description="先看注册时间、失败次数和活跃设备，再决定是否跳转审计页。"
        count={total}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Input value="当前版本暂未提供用户搜索" readOnly className="h-11 bg-muted/50 text-sm text-muted-foreground" />
            </div>
            <Badge variant="default">登录失败高亮</Badge>
            <Badge variant="secondary">设备承载可见</Badge>
          </div>
        }
      >
        {error ? (
          <AdminEmptyState
            title="用户数据暂时不可用"
            description="请检查后台 API 或认证状态，然后重新拉取用户列表。"
            action={<Button onClick={() => fetchUsers(page)}>重新加载</Button>}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold">邮箱</TableHead>
                    <TableHead className="text-xs font-semibold">注册时间</TableHead>
                    <TableHead className="text-xs font-semibold">登录次数</TableHead>
                    <TableHead className="text-xs font-semibold">登录失败次数</TableHead>
                    <TableHead className="text-xs font-semibold">最后登录</TableHead>
                    <TableHead className="text-xs font-semibold">活跃设备数</TableHead>
                    <TableHead className="text-xs font-semibold">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : users.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={7} className="p-0">
                            <AdminEmptyState
                              title="还没有用户"
                              description="当前工作区尚未建立用户身份，后续设备和审计链路也不会产生有效关联。"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    : users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-foreground">{user.email}</div>
                              <div className="text-xs text-muted-foreground">{user.id}</div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                          <TableCell className="text-sm font-medium">{user.loginCount}</TableCell>
                          <TableCell className="text-sm">
                            {user.failedLoginCount > 0 ? <Badge variant="destructive">{user.failedLoginCount} 次失败</Badge> : <Badge variant="bull">干净</Badge>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(user.lastLoginAt)}</TableCell>
                          <TableCell className="text-sm">{user.activeDeviceCount}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/admin/audit?userId=${encodeURIComponent(user.id)}`)}
                            >
                              查看事件
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            {!loading && total > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                <span>第 {page} 页，共 {total} 条用户记录</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </AdminPanel>
    </AdminPageFrame>
  );
}
