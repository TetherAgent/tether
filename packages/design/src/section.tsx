import { Info } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/utils'

type SectionProps = React.HTMLAttributes<HTMLElement> & {
  title: string
  description?: string
  count?: number
  countTone?: 'default' | 'brand'
  loading?: boolean
  loadingText?: string
}

const countToneClassMap = {
  default: 'bg-muted text-foreground-tertiary',
  brand: 'bg-brand-muted text-brand-text',
} as const

const Section = ({
  title,
  description,
  count,
  countTone = 'default',
  loading = false,
  loadingText = '加载中...',
  className,
  children,
  ...props
}: SectionProps) => (
  <section data-slot="section" className={cn('min-w-0', className)} {...props}>
    <div data-slot="section-header" className="mb-3 flex items-center justify-between gap-3">
      <div data-slot="section-title-row" className="flex min-w-0 items-center gap-2">
        <h2 data-slot="section-title" className="text-h3 font-semibold text-foreground">{title}</h2>
        {description ? (
          <span
            title={description}
            className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-foreground-tertiary transition-colors duration-fast ease-out hover:bg-muted hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      {typeof count === 'number' ? (
        <span
          data-slot="section-count"
          data-tone={countTone}
          className={cn(
            'rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums',
            countToneClassMap[countTone]
          )}
        >
          {count}
        </span>
      ) : null}
    </div>
    {loading ? <div data-slot="section-loading" className="py-6 text-center text-sm text-foreground-tertiary">{loadingText}</div> : children}
  </section>
)
Section.displayName = 'Section'

export { Section }
