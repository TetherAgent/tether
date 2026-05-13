import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster, toast } from '@tether/design';
import { eventBus } from '@tether/http';

import { AuthProvider } from './contexts/auth-context.js';
import { UiPreferencesProvider } from './contexts/ui-preferences-context.js';
import { WebRoutes } from './routes.js';
import { registerPwaServiceWorker } from './pwa.js';
import './styles.css';

function App() {
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
    <UiPreferencesProvider>
      <AuthProvider>
        <BrowserRouter>
          <WebRoutes />
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </UiPreferencesProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
registerPwaServiceWorker();
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
