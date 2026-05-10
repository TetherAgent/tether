import { useI18n } from '../../hooks/use-i18n.js';

export function ResultCard({
  usage,
  durationMs
}: {
  usage: { input_tokens: number; output_tokens: number; cost_usd?: number };
  durationMs?: number;
}) {
  const { t } = useI18n();
  const items: Array<{ label: string; value: string | number }> = [];
  if (typeof durationMs === 'number') {
    items.push({ label: t.chatsDuration, value: `${(durationMs / 1000).toFixed(1)}s` });
  }
  items.push(
    { label: t.chatsInputTokens, value: usage.input_tokens },
    { label: t.chatsOutputTokens, value: usage.output_tokens }
  );
  if (typeof usage.cost_usd === 'number') {
    items.push({ label: t.chatsCost, value: `$${usage.cost_usd.toFixed(4)}` });
  }

  return (
    <div className="mt-2 flex justify-end">
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full bg-[var(--cost-bg)] px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
        {items.map((item) => (
          <div key={item.label} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1">
            <span>{item.label}</span>
            <span className="font-medium tabular-nums text-foreground/80">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
