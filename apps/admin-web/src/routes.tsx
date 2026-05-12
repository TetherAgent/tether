import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminLayout } from './components/layout/admin-layout.js';
import { AdminLoginPage } from './pages/admin-login-page.js';
import { AdminRegisterPage } from './pages/admin-register-page.js';
import { AuditPage } from './pages/audit-page.js';
import { DashboardPage } from './pages/dashboard-page.js';
import { DevicesPage } from './pages/devices-page.js';
import { GatewaysPage } from './pages/gateways-page.js';
import { SessionDetailPage } from './pages/session-detail-page.js';
import { SessionsPage } from './pages/sessions-page.js';
import { UsersPage } from './pages/users-page.js';

export function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/register" element={<AdminRegisterPage />} />
      <Route element={<AdminLayout />}>
        <Route path="/admin/dashboard" element={<DashboardPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/devices" element={<DevicesPage />} />
        <Route path="/admin/gateways" element={<GatewaysPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/sessions" element={<SessionsPage />} />
        <Route path="/admin/sessions/:id" element={<SessionDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/admin/login" />} />
    </Routes>
  );
}
