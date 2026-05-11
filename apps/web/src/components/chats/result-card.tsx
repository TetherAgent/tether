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
    <div className="mt-2 flex min-w-0 justify-end">
      <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-[10px] leading-none text-primary/70">
        {items.map((item) => (
          <div key={item.label} className="flex shrink-0 items-center gap-1">
            <span>{item.label}</span>
            <span className="font-medium tabular-nums text-primary/85">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
