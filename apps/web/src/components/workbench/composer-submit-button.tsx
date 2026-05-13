import * as React from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { Button } from '@tether/design';

export function ComposerSubmitButton({
  className,
  disabled,
  icon,
  loading = false,
  onClick,
  title,
  type = 'button'
}: {
  className?: string;
  disabled: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  title: string;
  type?: 'button' | 'submit';
}) {
  return (
    <Button
      type={type}
      size="icon"
      variant="brand"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`chat-send-button workbench-submit-button h-10 w-10 rounded-full ${className ?? ''}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon ?? <ArrowUp className="h-4 w-4" />}
    </Button>
  );
}
