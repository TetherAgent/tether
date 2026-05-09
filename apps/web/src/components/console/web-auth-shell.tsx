import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';
import { ShieldCheck, TerminalSquare } from 'lucide-react';

import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { WebChromeControls } from './web-chrome-controls.js';

type WebAuthShellProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function WebAuthShell({ title, description, children, footer }: WebAuthShellProps) {
  const { isDark, toggleTheme } = useUiPreferences();
  const { locale, setLocale, t } = useI18n();

  return (
    <main className="web-auth-shell">
      <div className="web-auth-toolbar">
        <WebChromeControls
          locale={locale}
          onLocaleChange={setLocale}
          isDark={isDark}
          onThemeToggle={toggleTheme}
        />
      </div>
      <section className="web-auth-wrap">
        <aside className="web-auth-panel" aria-hidden="true">
          <div className="web-auth-brand">
            <div className="web-auth-brand-mark">
              <TerminalSquare className="size-5" />
            </div>
            <div>
              <div className="web-auth-kicker">{t.appName}</div>
              <div className="web-auth-brand-title">{t.authSurface}</div>
            </div>
          </div>
          <div className="web-auth-status-board">
            <div className="web-auth-status-row">
              <span>{t.gatewayList}</span>
              <strong>127.0.0.1</strong>
            </div>
            <div className="web-auth-status-row">
              <span>{t.connection}</span>
              <strong>{t.relay}</strong>
            </div>
            <div className="web-auth-status-row">
              <span>{t.transport}</span>
              <strong>{t.authTransportEventStream}</strong>
            </div>
          </div>
          <div className="web-auth-terminal">
            <div className="web-auth-terminal-bar">
              <span />
              <span />
              <span />
            </div>
            <pre>{`$ tether gateway status
${t.authDemoGatewayOnline}
$ tether attach latest --control
${t.authDemoSessionReady}`}</pre>
          </div>
        </aside>
        <Card variant="card" className="web-auth-card border border-border/60 bg-card/95 shadow-card">
          <CardHeader className="border-b border-border/50 pb-5">
            <div className="web-auth-card-heading">
              <div className="web-auth-card-icon">
                <ShieldCheck className="size-5" />
              </div>
              <div className="web-auth-card-meta">
                <Badge variant="default" className="web-auth-realm-badge">
                  {t.authSurface}
                </Badge>
                <div className="web-auth-app-name">
                  {t.appName}
                </div>
              </div>
            </div>
            <CardTitle className="web-auth-title">{title}</CardTitle>
            <CardDescription className="web-auth-description">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="web-auth-content">
            {children}
            {footer ? <div className="web-auth-footer">{footer}</div> : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
