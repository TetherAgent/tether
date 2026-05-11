import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';
import { Bot, Monitor, ShieldCheck, TerminalSquare, Zap } from 'lucide-react';

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
            <div className="web-auth-kicker">{t.appName}</div>
          </div>

          <div className="web-auth-hero">
            <div className="web-auth-hero-title">{t.authHeroTitle}</div>
            <div className="web-auth-hero-sub">{t.authHeroSub}</div>
          </div>

          <div className="web-auth-steps">
            {t.authQuickStartSteps.map((step, i) => (
              <div key={i} className="web-auth-step">
                <span className="web-auth-step-num">{i + 1}</span>
                <span className="web-auth-step-label">{step.label}</span>
                <code className="web-auth-step-cmd">{step.cmd}</code>
              </div>
            ))}
          </div>

          <div className="web-auth-features">
            <div className="web-auth-feature">
              <div className="web-auth-feature-icon"><Monitor className="size-4" /></div>
              <div>
                <div className="web-auth-feature-title">{t.authFeatureLocalTitle}</div>
                <div className="web-auth-feature-desc">{t.authFeatureLocalDesc}</div>
              </div>
            </div>
            <div className="web-auth-feature">
              <div className="web-auth-feature-icon"><Bot className="size-4" /></div>
              <div>
                <div className="web-auth-feature-title">{t.authFeatureChatTitle}</div>
                <div className="web-auth-feature-desc">{t.authFeatureChatDesc}</div>
              </div>
            </div>
            <div className="web-auth-feature">
              <div className="web-auth-feature-icon"><Zap className="size-4" /></div>
              <div>
                <div className="web-auth-feature-title">{t.authFeatureSyncTitle}</div>
                <div className="web-auth-feature-desc">{t.authFeatureSyncDesc}</div>
              </div>
            </div>
          </div>

          <div className="web-auth-status-strip">
            {t.authGatewayStatusRows.map((row, i) => (
              <div key={i} className="web-auth-status-pill">
                <span className="web-auth-status-dot" />
                {row.label}
              </div>
            ))}
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
