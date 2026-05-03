import * as React from 'react';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@tether/design';
import { ShieldCheck } from 'lucide-react';
import { useAdminI18n } from '../../hooks/use-i18n.js';

type AdminAuthShellProps = {
  mode: 'login' | 'register';
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AdminAuthShell({
  mode,
  title,
  description,
  children,
  footer,
}: AdminAuthShellProps) {
  const { t } = useAdminI18n();
  const modeLabel = mode === 'login' ? t.loginMode : t.registerMode;

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-[linear-gradient(180deg,var(--background)_0%,var(--canvas)_100%)] px-4 py-8 sm:px-6">
      <section className="mx-auto w-full max-w-[560px]">
        <Card variant="card" className="border border-border/60 bg-card/95 shadow-card">
          <CardHeader className="border-b border-border/50 pb-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-muted text-brand-text">
                <ShieldCheck className="size-5" />
              </div>
              <div className="space-y-1">
                <Badge variant="default" className="rounded-full px-3 py-1">
                  {modeLabel}
                </Badge>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
                  {t.appName}
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
