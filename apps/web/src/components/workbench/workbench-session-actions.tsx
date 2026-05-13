import * as React from 'react';
import { Archive, MoreHorizontal, Pencil, Square } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@tether/design';
import type { WorkbenchSessionRecord } from './types.js';

export function WorkbenchSessionActions({
  active,
  onArchive,
  onRename,
  onStop,
  session,
  t
}: {
  active: boolean;
  onArchive: (session: WorkbenchSessionRecord) => void;
  onRename: (session: WorkbenchSessionRecord) => void;
  onStop: (session: WorkbenchSessionRecord) => void;
  session: WorkbenchSessionRecord;
  t: { archiveSession: string; renameSession: string; stop: string };
}) {
  const canArchive = session.kind === 'chats' || session.status !== 'running';
  const canStop = session.kind === 'terminal' && session.status === 'running';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:bg-sidebar-accent ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-36">
        <DropdownMenuItem onClick={() => setTimeout(() => onRename(session), 0)} className="gap-2">
          <Pencil className="h-3.5 w-3.5" />
          {t.renameSession}
        </DropdownMenuItem>
        {canStop && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onStop(session)}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Square className="h-3.5 w-3.5" />
              {t.stop}
            </DropdownMenuItem>
          </>
        )}
        {canArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(session)}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Archive className="h-3.5 w-3.5" />
              {t.archiveSession}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
