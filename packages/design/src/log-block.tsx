import * as React from 'react'

import { cn } from './lib/utils'

type LogBlockProps = React.HTMLAttributes<HTMLPreElement>

function LogBlock({ className, children, ...props }: LogBlockProps) {
  return (
    <pre
      data-slot="log-block"
      className={cn(
        'overflow-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed tabular-nums text-muted-foreground ring-1 ring-border-subtle',
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  )
}

export { LogBlock }
