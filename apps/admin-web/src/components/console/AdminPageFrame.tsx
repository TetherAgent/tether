import * as React from 'react';
import { Badge, Card, CardAction, CardContent, CardHeader, Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle, Section, StatItem } from '@tether/design';
import { LucideIcon, Sparkles } from 'lucide-react';

type AdminPageFrameProps = {
  eyebrow: string;
  title: React.ReactNode;
  description: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
};

export function AdminPageFrame({
  eyebrow,
  title,
  description,
  actions,
  meta,
  children,
}: AdminPageFrameProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-4">
          <div>
            <Badge variant="default" className="rounded-full px-3 py-1 uppercase tracking-[0.18em]">
              {eyebrow}
            </Badge>
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-bold leading-tight text-foreground md:text-5xl">
              {title}
            </h1>
            <div className="max-w-4xl text-sm leading-7 text-muted-foreground">
              {description}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>
        {meta ? <div className="shrink-0">{meta}</div> : null}
      </header>
      {children}
    </div>
  );
}

type AdminMetricCardProps = {
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  tone?: 'default' | 'brand' | 'bull' | 'bear' | 'warning';
  icon: LucideIcon;
};

export function AdminMetricCard({
  label,
  value,
  helper,
  tone = 'default',
  icon: Icon,
}: AdminMetricCardProps) {
  return (
    <Card variant="card" className="min-h-[152px] border border-border/60 bg-card/95">
      <CardHeader className="gap-3 border-b border-border/50 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-tertiary">
              {label}
            </div>
            <StatItem label="当前指标" value={value} helper={helper} size="lg" tone={tone} />
          </div>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-muted text-brand-text shadow-brand">
            <Icon className="size-5" />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

type AdminPanelProps = {
  title: string;
  description?: string;
  count?: number;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function AdminPanel({
  title,
  description,
  count,
  toolbar,
  children,
  className,
}: AdminPanelProps) {
  return (
    <Card variant="card" className={className}>
      <CardHeader className="gap-4 border-b border-border/50 pb-4">
        <Section title={title} description={description} count={count} countTone="brand" className="w-full">
          <div className="hidden" />
        </Section>
        {toolbar ? <CardAction className="w-full">{toolbar}</CardAction> : null}
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}

type AdminEmptyStateProps = {
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function AdminEmptyState({ title, description, action }: AdminEmptyStateProps) {
  return (
    <Empty variant="card" className="min-h-[280px] border border-dashed border-border/70 bg-muted/15">
      <EmptyMedia variant="icon">
        <Sparkles className="size-4" />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
