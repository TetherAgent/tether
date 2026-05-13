import * as React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './hooks/use-auth.js';
import { readStoredNormalAuth } from './lib/api.js';

const GatewayAuthPage = React.lazy(() => import('./pages/gateway-auth-page.js').then((module) => ({ default: module.GatewayAuthPage })));
const LoginPage = React.lazy(() => import('./pages/login-page.js').then((module) => ({ default: module.LoginPage })));
const RegisterPage = React.lazy(() => import('./pages/register-page.js').then((module) => ({ default: module.RegisterPage })));
const ChatsPage = React.lazy(() => import('./pages/chats-page.js').then((module) => ({ default: module.ChatsPage })));
const TerminalPage = React.lazy(() => import('./pages/terminal-page.js').then((module) => ({ default: module.TerminalPage })));
const WorkbenchLayout = React.lazy(() => import('./components/workbench/workbench-layout.js').then((module) => ({ default: module.WorkbenchLayout })));
const LegacySessionsPage = React.lazy(() => import('./pages/legacy-sessions-page.js').then((module) => ({ default: module.LegacySessionsPage })));
const LegacySessionViewPage = React.lazy(() => import('./pages/legacy-session-view-page.js').then((module) => ({ default: module.LegacySessionViewPage })));

export function WebRoutes() {
  return (
    <React.Suspense fallback={null}>
      <Routes>
        <Route
          path="/register"
          element={(
            <RedirectAuthenticated>
              <RegisterPage />
            </RedirectAuthenticated>
          )}
        />
        <Route
          path="/login"
          element={(
            <RedirectAuthenticated>
              <LoginPage />
            </RedirectAuthenticated>
          )}
        />
        <Route path="/" element={<Navigate replace to="/chats" />} />
        <Route path="/gateway-auth" element={<GatewayAuthPage />} />
        <Route
          path="/sessions"
          element={(
            <RequireUserAuth>
              <LegacySessionsPage />
            </RequireUserAuth>
          )}
        />
        <Route
          path="/remote/session/:sessionId/replay"
          element={(
            <RequireUserAuth>
              <LegacySessionViewPage mode="replay" />
            </RequireUserAuth>
          )}
        />
        <Route
          path="/remote/session/:sessionId"
          element={(
            <RequireUserAuth>
              <LegacySessionViewPage mode="control" />
            </RequireUserAuth>
          )}
        />
        <Route element={<RequireUserAuth><WorkbenchLayout /></RequireUserAuth>}>
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/:sessionId" element={<ChatsPage />} />
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="/terminal/:sessionId" element={<TerminalPage />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/chats" />} />
      </Routes>
    </React.Suspense>
  );
}

function RequireUserAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  if (!authReady) {
    return null;
  }

  if (!storedNormalAuth) {
    return <Navigate replace to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} />;
  }

  return <>{children}</>;
}

function RedirectAuthenticated({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  if (!authReady) {
    return null;
  }

  if (storedNormalAuth) {
    const redirectParam = new URLSearchParams(location.search).get('redirect');
    const to = redirectParam?.startsWith('/') ? redirectParam : '/chats';
    return <Navigate replace to={to} />;
  }

  return <>{children}</>;
}
