import * as React from 'react';

import { WEB_LOCALE_STORAGE_KEY, WEB_THEME_STORAGE_KEY, type WebLocale } from '../i18n/messages.js';

type WebTheme = 'light' | 'dark';

type UiPreferencesContextValue = {
  locale: WebLocale;
  setLocale: (locale: WebLocale) => void;
  isDark: boolean;
  toggleTheme: () => void;
};

const UiPreferencesContext = React.createContext<UiPreferencesContextValue | null>(null);

function readLocale(): WebLocale {
  const stored = window.localStorage.getItem(WEB_LOCALE_STORAGE_KEY);
  return stored === 'en' ? 'en' : 'zh';
}

function readTheme(): WebTheme {
  return window.localStorage.getItem(WEB_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

export function UiPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<WebLocale>(() => readLocale());
  const [theme, setTheme] = React.useState<WebTheme>(() => readTheme());

  React.useEffect(() => {
    window.localStorage.setItem(WEB_LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  React.useEffect(() => {
    window.localStorage.setItem(WEB_THEME_STORAGE_KEY, theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const value = React.useMemo<UiPreferencesContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
    isDark: theme === 'dark',
    toggleTheme: () => {
      setTheme((current) => current === 'dark' ? 'light' : 'dark');
    }
  }), [locale, theme]);

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export { UiPreferencesContext };
