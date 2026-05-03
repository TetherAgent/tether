import * as React from 'react';
import { AdminAuthContext } from '../contexts/admin-auth-context.js';

export function useAdminAuth() {
  const context = React.useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used within <AdminAuthProvider>');
  return context;
}
