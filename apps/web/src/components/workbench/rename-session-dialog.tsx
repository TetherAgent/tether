import * as React from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from '@tether/design';

export type RenameDialogState = {
  id: string;
  value: string;
} | null;

export function RenameSessionDialog({
  onChange,
  onCommit,
  onOpenChange,
  open,
  cancelLabel,
  title,
  value
}: {
  cancelLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  value: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit();
            if (event.key === 'Escape') onOpenChange(false);
          }}
          className="mt-1"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button onClick={onCommit}>{title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
