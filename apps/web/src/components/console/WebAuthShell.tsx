import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';
import { ShieldCheck } from 'lucide-react';

import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { getWebCopy, type WebLocale } from '../../lib/ui-copy.js';
import { WebChromeControls } from './WebChromeControls.js';

type WebAuthShellProps = {
  realm: 'normal' | 'management';
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const REALM_LABEL: Record<WebAuthShellProps['realm'], Record<WebLocale, string>> = {
  normal: {
    zh: '会话访问域',
    en: 'Session access realm'
  },
  management: {
    zh: '管理访问域',
    en: 'Management access realm'
  }
};

export function WebAuthShell({ realm, title, description, children, footer }: WebAuthShellProps) {
  const { locale, setLocale, isDark, toggleTheme } = useUiPreferences();
  const copy = getWebCopy(locale);

  return (
    <main className="web-auth-shell">
      <section className="web-auth-wrap">
        <div className="web-auth-toolbar">
          <WebChromeControls
            locale={locale}
            onLocaleChange={setLocale}
            isDark={isDark}
            onThemeToggle={toggleTheme}
          />
        </div>
        <Card variant="card" className="web-auth-card border border-border/60 bg-card/95 shadow-card">
          <CardHeader className="border-b border-border/50 pb-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-muted text-brand-text">
                <ShieldCheck className="size-5" />
              </div>
              <div className="space-y-1">
                <Badge variant="default" className="rounded-full px-3 py-1">
                  {REALM_LABEL[realm][locale]}
                </Badge>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
                  {copy.appName}
                </div>
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">{title}</CardTitle>
            <CardDescription className="text-sm leading-6 text-muted-foreground">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {children}
            {footer ? <div className="border-t border-border/50 pt-4">{footer}</div> : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
