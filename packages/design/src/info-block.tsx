import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from './lib/utils'

type InfoBlockVariant = 'default' | 'info' | 'warning' | 'success' | 'error'

type InfoBlockProps = React.HTMLAttributes<HTMLElement> & {
  density?: 'sm' | 'md'
  asChild?: boolean
  variant?: InfoBlockVariant | string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

const infoBlockVariants = cva('rounded-md text-sm', {
  variants: {
    variant: {
      default: 'bg-muted text-muted-foreground',
      info: 'bg-brand-muted text-brand-text',
      warning: 'bg-warning-bg text-warning-fg',
      success: 'bg-bull-muted text-bull',
      error: 'bg-destructive/10 text-destructive',
    },
    density: {
      sm: 'p-3',
      md: 'p-4',
    },
  },
  defaultVariants: {
    variant: 'default',
    density: 'sm',
  },
})

function InfoBlock({ density = 'sm', variant = 'default', asChild = false, className, title, description, action, children, ...props }: InfoBlockProps) {
  const Comp = asChild ? Slot : 'div'
  const resolvedVariant = isInfoBlockVariant(variant) ? variant : 'default'

  return (
    <Comp
      data-slot="info-block"
      data-variant={variant}
      className={cn(infoBlockVariants({ variant: resolvedVariant, density }), className)}
      {...props}
    >
      {title || description || action ? (
        <div data-slot="info-block-content" className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <div data-slot="info-block-title" className="font-semibold text-current">{title}</div>}
            {description && <div data-slot="info-block-description" className="mt-1 text-xs text-current/80">{description}</div>}
          </div>
          {action ? <div data-slot="info-block-action">{action}</div> : null}
        </div>
      ) : children}
    </Comp>
  )
}

function isInfoBlockVariant(variant: string): variant is InfoBlockVariant {
  return variant === 'default' || variant === 'info' || variant === 'warning' || variant === 'success' || variant === 'error'
}

export { InfoBlock }
