import type * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { useAuth } from './hooks/use-auth.js';
import { readStoredNormalAuth } from './lib/api.js';
import { GatewayAuthPage } from './pages/gateway-auth-page.js';
import { LoginPage } from './pages/login-page.js';
import { RegisterPage } from './pages/register-page.js';
import { ChatsPage } from './pages/chats-page.js';

type WebRoutesProps = {
  sessionListSurface: React.ReactNode;
  renderSessionView: (sessionId: string, mode: 'control' | 'replay') => React.ReactNode;
};

export function WebRoutes({ sessionListSurface, renderSessionView }: WebRoutesProps) {
  return (
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
            {sessionListSurface}
          </RequireUserAuth>
        )}
      />
      <Route
        path="/remote/session/:sessionId/replay"
        element={(
          <RequireUserAuth>
            <SessionViewRoute mode="replay" renderSessionView={renderSessionView} />
          </RequireUserAuth>
        )}
      />
      <Route
        path="/remote/session/:sessionId"
        element={(
          <RequireUserAuth>
            <SessionViewRoute mode="control" renderSessionView={renderSessionView} />
          </RequireUserAuth>
        )}
      />
      <Route
        path="/chats"
        element={(
          <RequireUserAuth>
            <ChatsPage />
          </RequireUserAuth>
        )}
      />
      <Route
        path="/chats/:sessionId"
        element={(
          <RequireUserAuth>
            <ChatsPage />
          </RequireUserAuth>
        )}
      />
      <Route path="*" element={<Navigate replace to="/chats" />} />
    </Routes>
  );
}

function SessionViewRoute({
  mode,
  renderSessionView
}: {
  mode: 'control' | 'replay';
  renderSessionView: (sessionId: string, mode: 'control' | 'replay') => React.ReactNode;
}) {
  const { sessionId } = useParams();
  if (!sessionId) {
    return <Navigate replace to="/chats" />;
  }
  return <>{renderSessionView(sessionId, mode)}</>;
}

function RequireUserAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  if (!authReady) {
    return null;
  }

  if (!storedNormalAuth) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

function RedirectAuthenticated({ children }: { children: React.ReactNode }) {
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  if (!authReady) {
    return null;
  }

  if (storedNormalAuth) {
    return <Navigate replace to="/chats" />;
  }

  return <>{children}</>;
}
