import { Button, ButtonGroup, ThemeToggle } from '@tether/design';

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
      <ButtonGroup className="web-locale-switch">
        <Button
          type="button"
          size="sm"
          variant={locale === 'zh' ? 'default' : 'outline'}
          onClick={() => onLocaleChange('zh')}
        >
          {t.chinese}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={locale === 'en' ? 'default' : 'outline'}
          onClick={() => onLocaleChange('en')}
        >
          {t.english}
        </Button>
      </ButtonGroup>
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
