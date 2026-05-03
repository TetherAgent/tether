import { Button, ButtonGroup, ThemeToggle } from '@tether/design';

import { getWebCopy, type WebLocale } from '../../lib/ui-copy.js';

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
  const copy = getWebCopy(locale);

  return (
    <div className="web-chrome-controls">
      <ButtonGroup className="web-locale-switch">
        <Button
          type="button"
          size="sm"
          variant={locale === 'zh' ? 'default' : 'outline'}
          onClick={() => onLocaleChange('zh')}
        >
          {copy.chinese}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={locale === 'en' ? 'default' : 'outline'}
          onClick={() => onLocaleChange('en')}
        >
          {copy.english}
        </Button>
      </ButtonGroup>
      <ThemeToggle
        isDark={isDark}
        onToggle={onThemeToggle}
        size="icon-sm"
        variant="outline"
        aria-label={`${copy.themeLabel}: ${isDark ? copy.light : copy.dark}`}
      />
    </div>
  );
}
