import { useUiPreferences } from './use-ui-preferences.js';
import { getWebMessages } from '../i18n/messages.js';

export function useI18n() {
  const { locale, setLocale } = useUiPreferences();
  return {
    locale,
    setLocale,
    t: getWebMessages(locale)
  };
}
