import { useI18n } from '../../hooks/use-i18n.js';

export function ResultCard({
  usage,
  durationMs
}: {
  usage: { input_tokens: number; output_tokens: number; cost_usd?: number };
  durationMs?: number;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-2 grid gap-2 rounded-2xl bg-[var(--cost-bg)] px-3 py-2 text-xs text-muted-foreground shadow-sm">
      {typeof durationMs === 'number' ? (
        <div className="flex items-center justify-between">
          <span>{t.chatsDuration}</span>
          <span>{(durationMs / 1000).toFixed(1)}s</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span>{t.chatsInputTokens}</span>
        <span>{usage.input_tokens}</span>
      </div>
      <div className="flex items-center justify-between">
        <span>{t.chatsOutputTokens}</span>
        <span>{usage.output_tokens}</span>
      </div>
      {typeof usage.cost_usd === 'number' ? (
        <div className="flex items-center justify-between">
          <span>{t.chatsCost}</span>
          <span>${usage.cost_usd.toFixed(4)}</span>
        </div>
      ) : null}
    </div>
  );
}
