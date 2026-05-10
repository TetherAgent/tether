import { ShieldAlert } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';

export function PermissionPrompt({ toolName }: { toolName: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-4 w-4" />
        {t.chatsPermissionTitle}
      </div>
      <div>{t.chatsPermissionAsk.replace('{tool}', toolName)}</div>
      <div className="mt-1 text-xs opacity-80">{t.chatsPermissionDeferred}</div>
    </div>
  );
}
