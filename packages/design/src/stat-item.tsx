import * as React from 'react'

import { cn } from './lib/utils'

type StatItemProps = {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'brand' | 'bull' | 'bear' | 'warning'
  size?: 'sm' | 'md' | 'lg'
  helper?: React.ReactNode
  className?: string
}

const toneClassMap = {
  default: 'text-foreground',
  brand: 'text-brand-text',
  bull: 'text-bull',
  bear: 'text-bear',
  warning: 'text-warning-fg',
} as const

const valueSizeClassMap = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-stat-lg leading-tight',
} as const

function StatItem({ label, value, tone = 'default', size = 'md', helper, className }: StatItemProps) {
  return (
    <div data-slot="stat-item" className={cn('flex flex-col gap-1', size === 'lg' && 'gap-2', className)}>
      <span data-slot="stat-item-label" className="text-xs text-foreground-tertiary">{label}</span>
      <span data-slot="stat-item-value" className={cn('font-semibold tabular-nums', valueSizeClassMap[size], toneClassMap[tone])}>
        {value}
      </span>
      {helper ? <span data-slot="stat-item-helper" className="text-xs text-muted-foreground">{helper}</span> : null}
    </div>
  )
}

export { StatItem }
