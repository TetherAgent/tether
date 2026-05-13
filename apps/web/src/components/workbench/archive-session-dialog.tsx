import * as React from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@tether/design';

export function ArchiveSessionDialog({
  confirmLabel,
  cancelLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  title
}: {
  cancelLabel: string;
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
