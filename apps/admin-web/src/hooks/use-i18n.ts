import * as React from 'react';

import {
  ADMIN_LOCALE_STORAGE_KEY,
  getAdminMessages,
  type AdminLocale
} from '../i18n/messages.js';

function readAdminLocale(): AdminLocale {
  const stored = window.localStorage.getItem(ADMIN_LOCALE_STORAGE_KEY);
  if (stored === 'en' || stored === 'zh') {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function useAdminI18n() {
  const [locale, setLocaleState] = React.useState<AdminLocale>(() => readAdminLocale());

  const setLocale = React.useCallback((next: AdminLocale) => {
    window.localStorage.setItem(ADMIN_LOCALE_STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  return {
    locale,
    setLocale,
    t: getAdminMessages(locale)
  };
}
