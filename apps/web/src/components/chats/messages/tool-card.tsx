import { ChevronRight, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@tether/design';

export function ToolCard({
  toolName,
  input,
  result,
  isError,
  isInFlight
}: {
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  isInFlight?: boolean;
}) {
  return (
    <Collapsible className="rounded-2xl border border-[var(--tool-border)] bg-[var(--tool-bg)]">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <Wrench className="h-4 w-4 text-[var(--tool-accent)]" />
        <span className="font-semibold">{toolName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {JSON.stringify(input)}
        </span>
        <ChevronRight className="h-4 w-4 text-[var(--tool-accent)]" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-[var(--tool-border)] px-3 py-3">
        <pre className="overflow-x-auto rounded-xl bg-[var(--code-bg)] p-3 text-xs text-[var(--code-text)]">
          {JSON.stringify(input, null, 2)}
        </pre>
        {isInFlight ? <div className="text-xs text-muted-foreground">Running…</div> : null}
        {result ? (
          <pre
            className={`overflow-x-auto rounded-xl p-3 text-xs ${
              isError
                ? 'border border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-accent)]'
                : 'border border-[var(--tool-result-border)] bg-[var(--tool-result-bg)] text-[var(--tool-result-accent)]'
            }`}
          >
            {result}
          </pre>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
