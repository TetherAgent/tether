import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { getDashboardStats } from '../lib/admin-api.js';
import { useAdminAuth } from '../hooks/use-admin-auth.js';

type Stats = {
  totalUsers: number;
  activeDevices: number;
  registeredGateways: number;
  auditEventsLast7Days: number;
};

export function DashboardPage() {
  const { managementAuth } = useAdminAuth();
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!managementAuth?.accessToken) return;
    getDashboardStats(managementAuth.accessToken)
      .then(setStats)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'load_failed')
      );
  }, [managementAuth]);

  const statItems: Array<{ label: string; value: number | string }> = stats
    ? [
        { label: '已注册用户', value: stats.totalUsers },
        { label: '活跃设备', value: stats.activeDevices },
        { label: '注册 Gateway', value: stats.registeredGateways },
        { label: '近 7 天审计事件', value: stats.auditEventsLast7Days },
      ]
    : [
        { label: '已注册用户', value: '—' },
        { label: '活跃设备', value: '—' },
        { label: '注册 Gateway', value: '—' },
        { label: '近 7 天审计事件', value: '—' },
      ];

  if (error) {
    return (
      <p className="text-destructive text-sm">数据加载失败，请检查网络连接后重试。</p>
    );
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-6">概览</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {statItems.map(item => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
