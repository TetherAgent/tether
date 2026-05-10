import { ShieldAlert } from 'lucide-react';
import { Button } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';

export function PermissionPrompt({
  toolName,
  requestId,
  onAllow,
  onDeny,
  decided
}: {
  toolName: string;
  requestId?: string;
  onAllow?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
  decided?: 'allow' | 'deny';
}) {
  const { t } = useI18n();
  const interactive = requestId && onAllow && onDeny && !decided;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="mb-1.5 flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-4 w-4" />
        {t.chatsPermissionTitle}
      </div>
      <div className="mb-2">{t.chatsPermissionAsk.replace('{tool}', toolName)}</div>
      {interactive ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-400 bg-transparent px-3 text-[12px] text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => onAllow(requestId)}
          >
            {t.chatsPermissionAllow}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-400 bg-transparent px-3 text-[12px] text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => onDeny(requestId)}
          >
            {t.chatsPermissionDeny}
          </Button>
        </div>
      ) : decided ? (
        <div className="text-xs opacity-70">
          {decided === 'allow' ? t.chatsPermissionAllowed : t.chatsPermissionDenied}
        </div>
      ) : (
        <div className="text-xs opacity-80">{t.chatsPermissionDeferred}</div>
      )}
    </div>
  );
}
