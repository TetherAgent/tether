import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster, toast } from '@tether/design';
import { eventBus } from '@tether/http';
import { AdminAuthProvider } from './contexts/admin-auth-context.js';
import { AdminLayout } from './components/layout/AdminLayout.js';
import { AdminLoginPage } from './pages/AdminLoginPage.js';
import { AdminRegisterPage } from './pages/AdminRegisterPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { DevicesPage } from './pages/DevicesPage.js';
import { GatewaysPage } from './pages/GatewaysPage.js';
import { AuditPage } from './pages/AuditPage.js';
import './styles.css';

function AdminApp() {
  React.useEffect(() => {
    const onApiError = (message: string) => {
      toast.error(message);
    };
    eventBus.on('apiError', onApiError);
    return () => {
      eventBus.off('apiError', onApiError);
    };
  }, []);

  return (
    <BrowserRouter>
      <AdminAuthProvider>
        <Routes>
          {/* 登录/注册页：在 AdminLayout 之外，避免 auth guard 循环重定向 */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/register" element={<AdminRegisterPage />} />
          {/* 受保护路由：AdminLayout 内含 auth guard */}
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/devices" element={<DevicesPage />} />
            <Route path="/admin/gateways" element={<GatewaysPage />} />
            <Route path="/admin/audit" element={<AuditPage />} />
          </Route>
          {/* catch-all 重定向到登录页（未登录用户访问任意未知路由 → 登录）*/}
          <Route path="*" element={<Navigate replace to="/admin/login" />} />
        </Routes>
        <Toaster />
      </AdminAuthProvider>
    </BrowserRouter>
  );
}

const root = document.getElementById('root')!;
createRoot(root).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
