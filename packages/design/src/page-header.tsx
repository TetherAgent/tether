import * as React from 'react'

import { cn } from './lib/utils'

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
}

function PageHeader({ title, description, meta, className, children, ...props }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn('flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between', className)} {...props}>
      <div data-slot="page-header-content" className="min-w-0 space-y-2">
        <h1 data-slot="page-header-title" className="text-h1 font-bold text-foreground">{title}</h1>
        {description ? <div data-slot="page-header-description" className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</div> : null}
        {children}
      </div>
      {meta ? <div data-slot="page-header-meta" className="shrink-0">{meta}</div> : null}
    </header>
  )
}

export { PageHeader }
