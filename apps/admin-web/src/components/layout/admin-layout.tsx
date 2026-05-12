import * as React from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge, Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@tether/design';
import { LayoutGrid, LogOut, Menu, Router, ScanSearch, Shield, SquareTerminal, Users, Waypoints } from 'lucide-react';
import { useAdminAuth } from '../../hooks/use-admin-auth.js';

const NAV_ITEMS = [
  {
    label: '概览',
    hint: '全局态势',
    path: '/admin/dashboard',
    icon: LayoutGrid,
  },
  {
    label: '用户',
    hint: '身份与活跃度',
    path: '/admin/users',
    icon: Users,
  },
  {
    label: '设备',
    hint: '终端接入面',
    path: '/admin/devices',
    icon: Shield,
  },
  {
    label: 'Gateway',
    hint: '节点链路',
    path: '/admin/gateways',
    icon: Router,
  },
  {
    label: '审计',
    hint: '事件取证',
    path: '/admin/audit',
    icon: ScanSearch,
  },
  {
    label: '会话',
    hint: '消息与事件流',
    path: '/admin/sessions',
    icon: SquareTerminal,
  },
] as const;

const PAGE_META = [
  { match: '/admin/dashboard', title: 'Control Overview', description: '统一查看账号、设备、Gateway 与审计态势。' },
  { match: '/admin/users', title: 'Identity Surface', description: '处理用户增长、登录质量与设备活跃度。' },
  { match: '/admin/devices', title: 'Device Access', description: '管理终端接入状态，快速执行吊销操作。' },
  { match: '/admin/gateways', title: 'Gateway Health', description: '监控节点在线性与链接关系。' },
  { match: '/admin/audit', title: 'Audit Ledger', description: '按用户、动作和时间筛查关键事件。' },
  { match: '/admin/sessions', title: 'Session Explorer', description: '查看 Gateway 会话的消息历史和事件流。' },
] as const;

export function AdminLayout() {
  const { authReady, managementAuth, logoutManagement } = useAdminAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  if (!authReady) return null;

  if (!managementAuth) {
    return <Navigate replace to="/admin/login" state={{ from: location.pathname }} />;
  }

  const email = managementAuth.identity?.adminEmail ?? managementAuth.identity?.adminUserId ?? '';
  const currentPage = PAGE_META.find((item) => location.pathname.startsWith(item.match)) ?? PAGE_META[0];

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[linear-gradient(180deg,var(--background)_0%,color-mix(in_srgb,var(--canvas)_88%,var(--brand-muted))_100%)] text-foreground">
      <aside className="hidden w-[272px] shrink-0 border-r border-border/60 bg-card/92 px-3 py-4 backdrop-blur xl:flex xl:flex-col">
        <SidebarContent email={email} logoutManagement={logoutManagement} onNavigate={() => {}} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border/60 bg-background/85 px-4 py-4 backdrop-blur md:px-6">
          <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-3 xl:hidden">
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger
                    render={
                      <Button variant="outline" size="icon-sm" />
                    }
                  >
                    <Menu className="size-4" />
                    <span className="sr-only">打开菜单</span>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[86vw] max-w-[320px] border-r border-border/60 bg-card/95 p-0">
                    <SheetHeader className="border-b border-border/60 px-4 py-4 text-left">
                      <SheetTitle>Admin Navigation</SheetTitle>
                      <SheetDescription>在手机上通过这里切换后台页面。</SheetDescription>
                    </SheetHeader>
                    <div className="flex h-full flex-col px-3 py-4">
                      <SidebarContent email={email} logoutManagement={logoutManagement} onNavigate={() => setMobileNavOpen(false)} />
                    </div>
                  </SheetContent>
                </Sheet>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-text">Tether</div>
                  <div className="truncate text-sm font-semibold text-foreground">Admin Console</div>
                </div>
              </div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-text">
                {currentPage.title}
              </div>
              <div className="mt-1 text-2xl font-bold text-foreground md:text-3xl">
                管理控制台
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {currentPage.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="hidden rounded-2xl border border-border/60 bg-card/80 px-4 py-3 shadow-card sm:block">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="size-4 text-brand-text" />
                  {email}
                </div>
              </div>
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                Admin realm
              </Badge>
              <Badge variant="default" className="hidden rounded-full px-3 py-1 sm:inline-flex">
                Live control surface
              </Badge>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  email,
  logoutManagement,
  onNavigate,
}: {
  email: string;
  logoutManagement: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/80 px-3 py-3 shadow-card">
        <div className="flex size-10 items-center justify-center rounded-xl bg-brand-muted text-brand-text">
          <Waypoints className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-text">
            Tether
          </div>
          <div className="truncate text-sm font-semibold text-foreground">
            Admin Console
          </div>
        </div>
        <Badge variant="secondary" className="ml-auto rounded-full px-2 py-0.5 text-[10px]">
          Admin
        </Badge>
      </div>

      <div className="px-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
        Navigation
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={({ isActive }) => {
              const base = 'group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors';
              return isActive
                ? `${base} border-brand-muted bg-brand-muted/75 text-brand-text`
                : `${base} border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:bg-background/70 hover:text-foreground`;
            }}
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-background/70 text-current ring-1 ring-border/50 group-hover:bg-card">
              <item.icon className="size-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="truncate text-xs text-current/70">{item.hint}</div>
            </div>
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-3 shadow-card">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
          Operator
        </div>
        <div className="mt-2 flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-muted text-brand-text">
            <Users className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{email}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Management realm session</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Badge variant="default" className="rounded-full px-2.5 py-0.5 text-[10px]">
            Live control
          </Badge>
          <Button variant="outline" size="sm" className="ml-auto h-8 px-3" onClick={logoutManagement}>
            <span className="inline-flex items-center gap-1.5">
              <LogOut className="size-3.5" />
              退出
            </span>
          </Button>
        </div>
      </div>
    </>
  );
}
