import * as React from 'react';

import { UiPreferencesContext } from '../contexts/ui-preferences-context.js';

export function useUiPreferences() {
  const context = React.useContext(UiPreferencesContext);
  if (!context) {
    throw new Error('useUiPreferences must be used within <UiPreferencesProvider>');
  }
  return context;
}
