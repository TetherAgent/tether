import { Languages } from 'lucide-react';

import { Button, ThemeToggle } from '@tether/design';

import { getWebMessages, type WebLocale } from '../../i18n/messages.js';

type WebChromeControlsProps = {
  locale: WebLocale;
  onLocaleChange: (locale: WebLocale) => void;
  isDark: boolean;
  onThemeToggle: () => void;
};

export function WebChromeControls({
  locale,
  onLocaleChange,
  isDark,
  onThemeToggle
}: WebChromeControlsProps) {
  const t = getWebMessages(locale);

  return (
    <div className="web-chrome-controls">
      <Button
        className="web-chrome-button"
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={locale === 'zh' ? '切换到英文' : 'Switch to Chinese'}
        title={locale === 'zh' ? '切换到英文' : 'Switch to Chinese'}
        onClick={() => onLocaleChange(locale === 'zh' ? 'en' : 'zh')}
      >
        <Languages className="size-4" />
      </Button>
      <ThemeToggle
        isDark={isDark}
        onToggle={onThemeToggle}
        size="icon-sm"
        variant="outline"
        aria-label={`${t.themeLabel}: ${isDark ? t.light : t.dark}`}
      />
    </div>
  );
}
