import type * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { useAuth } from './hooks/use-auth.js';
import { LandingPage } from './pages/landing-page.js';
import { LoginPage } from './pages/login-page.js';
import { RegisterPage } from './pages/register-page.js';

type WebRoutesProps = {
  sessionListSurface: React.ReactNode;
  renderSessionView: (sessionId: string) => React.ReactNode;
};

export function WebRoutes({ sessionListSurface, renderSessionView }: WebRoutesProps) {
  return (
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/sessions"
        element={(
          <RequireUserAuth>
            {sessionListSurface}
          </RequireUserAuth>
        )}
      />
      <Route
        path="/remote/session/:sessionId"
        element={(
          <RequireUserAuth>
            <SessionViewRoute renderSessionView={renderSessionView} />
          </RequireUserAuth>
        )}
      />
      <Route path="*" element={<Navigate replace to="/sessions" />} />
    </Routes>
  );
}

function SessionViewRoute({ renderSessionView }: { renderSessionView: (sessionId: string) => React.ReactNode }) {
  const { sessionId } = useParams();
  if (!sessionId) {
    return <Navigate replace to="/sessions" />;
  }
  return <>{renderSessionView(sessionId)}</>;
}

function RequireUserAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();

  if (!authReady) {
    return null;
  }

  if (!normalAuth) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
