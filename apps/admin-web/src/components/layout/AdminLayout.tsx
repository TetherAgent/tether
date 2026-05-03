import * as React from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '../../hooks/use-admin-auth.js';

const NAV_ITEMS = [
  { label: '概览', path: '/admin/dashboard' },
  { label: '用户', path: '/admin/users' },
  { label: '设备', path: '/admin/devices' },
  { label: 'Gateway', path: '/admin/gateways' },
  { label: '审计', path: '/admin/audit' }
] as const;

export function AdminLayout() {
  const { authReady, managementAuth, logoutManagement } = useAdminAuth();
  const location = useLocation();

  if (!authReady) return null;

  if (!managementAuth) {
    return <Navigate replace to="/admin/login" state={{ from: location.pathname }} />;
  }

  const email = managementAuth.identity?.adminUserId ?? '';

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: 'hsl(var(--card))',
          borderRight: '1px solid hsl(var(--border))',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 0'
        }}
      >
        <div style={{ padding: '0 16px 16px', fontWeight: 600, fontSize: 14, color: 'hsl(var(--foreground))' }}>
          Tether Admin
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 16px',
                fontSize: 14,
                textDecoration: 'none',
                color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                background: isActive ? 'hsl(var(--primary) / 0.05)' : 'transparent',
                borderLeft: isActive ? '2px solid hsl(var(--primary))' : '2px solid transparent'
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <header
          style={{
            height: 52,
            flexShrink: 0,
            background: 'hsl(var(--secondary))',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px'
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            管理控制台
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{email}</span>
            <button
              onClick={logoutManagement}
              style={{
                background: 'transparent',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 13,
                color: 'hsl(var(--muted-foreground))',
                cursor: 'pointer'
              }}
            >
              退出
            </button>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
