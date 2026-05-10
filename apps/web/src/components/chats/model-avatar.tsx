import * as React from 'react';

const gradients: Record<string, string> = {
  claude: 'linear-gradient(135deg, #c084fc, #6366f1)',
  codex: 'linear-gradient(135deg, #60a5fa, #2563eb)',
  copilot: 'linear-gradient(135deg, #fb923c, #ea580c)'
};

export function ModelAvatar({
  provider,
  label,
  className
}: {
  provider?: string;
  label?: string;
  className?: string;
}) {
  const key = (provider ?? '').toLowerCase();
  const initial = (label ?? provider ?? 'A').slice(0, 1).toUpperCase();
  return (
    <div
      aria-hidden="true"
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold text-white ${className ?? ''}`}
      style={{ background: gradients[key] ?? gradients.claude }}
    >
      {initial}
    </div>
  );
}
