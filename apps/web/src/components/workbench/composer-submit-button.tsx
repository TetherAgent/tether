import * as React from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

export function ComposerSubmitButton({
  disabled,
  loading = false,
  onClick,
  title,
  type = 'button'
}: {
  disabled: boolean;
  loading?: boolean;
  onClick?: () => void;
  title: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`chat-send-button composer-submit-button ${
        disabled
          ? 'composer-submit-button--disabled'
          : 'composer-submit-button--active'
      }`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
    </button>
  );
}
