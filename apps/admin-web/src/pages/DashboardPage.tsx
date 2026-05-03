import * as React from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, InfoBlock, Skeleton } from '@tether/design';
import { ArrowRight, LayoutGrid, Router, Shield, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdminMetricCard, AdminPageFrame, AdminPanel } from '../components/console/AdminPageFrame.js';
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

  const statItems = [
    {
      label: '已注册用户',
      value: stats?.totalUsers ?? '—',
      helper: '控制面下已建立身份',
      tone: 'brand' as const,
      icon: Users,
    },
    {
      label: '活跃设备',
      value: stats?.activeDevices ?? '—',
      helper: '最近仍在回传状态的终端',
      tone: 'bull' as const,
      icon: Shield,
    },
    {
      label: '注册 Gateway',
      value: stats?.registeredGateways ?? '—',
      helper: '可被后台接管的节点数',
      tone: 'warning' as const,
      icon: Router,
    },
    {
      label: '近 7 天审计事件',
      value: stats?.auditEventsLast7Days ?? '—',
      helper: '近期关键操作密度',
      tone: 'default' as const,
      icon: LayoutGrid,
    },
  ];

  if (error) {
    return (
      <AdminPageFrame
        eyebrow="Operations"
        title="管理总览"
        description="从一个地方判断平台现在是否健康，哪些链路需要马上介入。"
      >
        <InfoBlock variant="error" title="数据加载失败" description="请检查网络连接或认证状态后重试。" />
      </AdminPageFrame>
    );
  }

  return (
    <AdminPageFrame
      eyebrow="Operations"
      title="管理总览"
      description="先看平台主信号，再决定应该去用户、设备、Gateway 还是审计链路深入处理。"
      actions={
        <>
          <Badge variant="secondary">后台域</Badge>
          <Badge variant="default">实时运营视角</Badge>
        </>
      }
      meta={
        <div className="rounded-2xl border border-border/60 bg-card/85 px-4 py-3 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
            Focus
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            先给结论，再下钻问题链路
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statItems.map((item) => (
          <AdminMetricCard
            key={item.label}
            label={item.label}
            value={stats ? item.value : <Skeleton className="h-10 w-24" />}
            helper={item.helper}
            tone={item.tone}
            icon={item.icon}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <AdminPanel
          title="系统态势"
          description="用一句话把当前管理面最重要的状态钉出来。"
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card variant="card" className="border border-border/60 bg-background/70">
              <CardHeader>
                <CardTitle className="text-base">身份面</CardTitle>
                <CardDescription>账号体系与登录质量</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-3xl font-bold text-foreground">{stats?.totalUsers ?? '—'}</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  当前已注册用户规模，以及后续设备与事件的身份承载基线。
                </p>
              </CardContent>
            </Card>

            <Card variant="card" className="border border-border/60 bg-background/70">
              <CardHeader>
                <CardTitle className="text-base">终端面</CardTitle>
                <CardDescription>在线终端与接入健康度</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-3xl font-bold text-bull">{stats?.activeDevices ?? '—'}</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  活跃设备越多，说明移动端和客户端接入链路越稳定。
                </p>
              </CardContent>
            </Card>

            <Card variant="card" className="border border-border/60 bg-background/70">
              <CardHeader>
                <CardTitle className="text-base">审计面</CardTitle>
                <CardDescription>最近一周操作强度</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-3xl font-bold text-warning-fg">{stats?.auditEventsLast7Days ?? '—'}</div>
                <p className="text-sm leading-6 text-muted-foreground">
                  这不是噪音数字，而是后台运营和异常处理频率的直接反馈。
                </p>
              </CardContent>
            </Card>
          </div>
        </AdminPanel>

        <AdminPanel
          title="快速进入"
          description="从这里直接跳到正在处理的工作面。"
        >
          <div className="grid gap-3">
            {[
              {
                title: '用户管理',
                description: '查看注册质量、登录失败和活跃设备分布。',
                to: '/admin/users',
              },
              {
                title: '设备处理',
                description: '快速吊销异常终端，控制接入面风险。',
                to: '/admin/devices',
              },
              {
                title: '审计筛查',
                description: '按用户、动作和时间窗口追踪问题链路。',
                to: '/admin/audit',
              },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="group rounded-2xl border border-border/60 bg-background/75 p-4 transition-colors hover:border-brand-muted hover:bg-brand-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="text-sm font-semibold text-foreground">{item.title}</div>
                    <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                  </div>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-brand-text" />
                </div>
              </Link>
            ))}
          </div>
        </AdminPanel>
      </div>
    </AdminPageFrame>
  );
}
