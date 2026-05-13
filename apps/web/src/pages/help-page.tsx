import { Link } from 'react-router-dom';
import { ArrowRight, LogIn, MessageSquare, TerminalSquare } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';

import { useI18n } from '../hooks/use-i18n.js';
import { useUiPreferences } from '../hooks/use-ui-preferences.js';
import { WebChromeControls } from '../components/console/web-chrome-controls.js';

export function HelpPage() {
  const { locale, setLocale, t } = useI18n();
  const { isDark, toggleTheme } = useUiPreferences();

  return (
    <main className="help-page min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5">
        <div className="flex items-center justify-between">
          <Link to="/chats" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-black" style={{ background: 'var(--gradient-brand)' }}>
              T
            </span>
            Tether
          </Link>
          <WebChromeControls
            locale={locale}
            onLocaleChange={setLocale}
            isDark={isDark}
            onThemeToggle={toggleTheme}
          />
        </div>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <TerminalSquare className="h-3.5 w-3.5 text-brand" />
              {t.helpEyebrow}
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-4xl font-bold leading-tight tracking-normal md:text-5xl">
                {t.helpTitle}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                {t.helpDescription}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/chats">
                  {t.helpOpenChats}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/terminal">{t.helpOpenTerminal}</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link to="/login">
                  <LogIn className="h-4 w-4" />
                  {t.signIn}
                </Link>
              </Button>
            </div>
          </div>

          <Card className="border-border/70 bg-card/95 shadow-card">
            <CardHeader>
              <CardTitle>{t.helpQuickStartTitle}</CardTitle>
              <CardDescription>{t.helpQuickStartDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {t.helpQuickStartSteps.map((step, index) => (
                  <div key={step.cmd} className="grid gap-2 rounded-lg bg-muted/25 p-3 sm:grid-cols-[24px_1fr]">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/10 text-xs font-bold text-brand">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{step.label}</div>
                      <code className="mt-1 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">
                        {step.cmd}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 pb-10 md:grid-cols-2">
          <HelpCard
            icon={<MessageSquare className="h-5 w-5" />}
            title={t.helpChatTitle}
            description={t.helpChatDescription}
            primaryLabel={t.helpBestForLabel}
            primaryItems={t.helpChatUseCases}
            secondaryLabel={t.helpHowToUseLabel}
            secondaryItems={t.helpChatSteps}
          />
          <HelpCard
            icon={<TerminalSquare className="h-5 w-5" />}
            title={t.helpTerminalTitle}
            description={t.helpTerminalDescription}
            commands={t.helpTerminalCommands}
            primaryLabel={t.helpBestForLabel}
            primaryItems={t.helpTerminalUseCases}
            secondaryLabel={t.helpHowToUseLabel}
            secondaryItems={t.helpTerminalSteps}
          />
        </section>
      </div>
    </main>
  );
}

function HelpCard({
  commands,
  description,
  icon,
  primaryItems,
  primaryLabel,
  secondaryItems,
  secondaryLabel,
  title
}: {
  commands?: readonly { label: string; cmd: string }[];
  description: string;
  icon: React.ReactNode;
  primaryItems: readonly string[];
  primaryLabel: string;
  secondaryItems: readonly string[];
  secondaryLabel: string;
  title: string;
}) {
  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader>
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          {icon}
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-brand">{primaryLabel}</div>
            <ul className="space-y-2 text-sm leading-6 text-muted-foreground">
              {primaryItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-brand">{secondaryLabel}</div>
            <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
              {secondaryItems.map((item, index) => (
                <li key={item} className="grid grid-cols-[22px_1fr] gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/15 text-[11px] font-bold text-brand">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          {commands && commands.length > 0 ? (
            <div className="space-y-2">
              {commands.map((command) => (
                <div key={command.cmd}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{command.label}</div>
                  <code className="block overflow-x-auto rounded-lg bg-background px-3 py-2.5 font-mono text-xs font-semibold text-foreground">
                    {command.cmd}
                  </code>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
