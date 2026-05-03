import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster, toast } from '@tether/design';
import { eventBus } from '@tether/http';
import { AdminAuthProvider } from './contexts/admin-auth-context.js';
import { AdminRoutes } from './routes.js';
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
        <AdminRoutes />
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
