import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminAuthProvider } from './contexts/admin-auth-context.js';
import { AdminLayout } from './components/layout/AdminLayout.js';
import { AdminLoginPage } from './pages/AdminLoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { UsersPage } from './pages/UsersPage.js';
import './styles.css';

// 页面占位（Plan 05 会替换这些）
function PlaceholderPage({ title }: { title: string }) {
  return <div className="text-muted-foreground">{title} 页面（开发中）</div>;
}

const root = document.getElementById('root')!;
createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminAuthProvider>
        <Routes>
          {/* 登录页：在 AdminLayout 之外，避免 auth guard 循环重定向 */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          {/* 受保护路由：AdminLayout 内含 auth guard */}
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/devices" element={<PlaceholderPage title="设备" />} />
            <Route path="/admin/gateways" element={<PlaceholderPage title="Gateway" />} />
            <Route path="/admin/audit" element={<PlaceholderPage title="审计" />} />
          </Route>
          {/* catch-all 重定向到登录页（未登录用户访问任意未知路由 → 登录）*/}
          <Route path="*" element={<Navigate replace to="/admin/login" />} />
        </Routes>
      </AdminAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
