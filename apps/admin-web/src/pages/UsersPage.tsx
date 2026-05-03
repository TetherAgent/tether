import * as React from 'react';
import { useNavigate } from 'react-router-dom';
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

  return (
    <div>
      <h1 className="text-lg font-semibold mb-6">用户</h1>

      {error && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-destructive text-sm">数据加载失败，请检查网络连接后重试。</p>
          <Button variant="outline" size="sm" onClick={() => fetchUsers(page)}>
            重试
          </Button>
        </div>
      )}

      <div className="rounded-md border">
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
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground"
                    >
                      <p className="font-medium">暂无用户</p>
                      <p className="text-xs mt-1">当前工作区还没有注册用户。</p>
                    </TableCell>
                  </TableRow>
                )
              : users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="text-sm">{user.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{user.loginCount}</TableCell>
                    <TableCell className="text-sm text-destructive">
                      {user.failedLoginCount}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.lastLoginAt)}
                    </TableCell>
                    <TableCell className="text-sm">{user.activeDeviceCount}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          navigate(
                            `/admin/audit?userId=${encodeURIComponent(user.id)}`
                          )
                        }
                      >
                        查看事件
                      </Button>
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
    </div>
  );
}
