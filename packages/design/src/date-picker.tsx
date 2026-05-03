import dayjs from 'dayjs'
import { ChevronDown } from 'lucide-react'
import * as React from 'react'

import { Calendar } from './calendar'
import { cn } from './lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  triggerClassName?: string
  placeholder?: string
}

function DatePicker({ value, onChange, className, triggerClassName, placeholder = '点击选择日期' }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = value ? dayjs(value).toDate() : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn('group flex h-9 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-left text-sm font-semibold text-foreground shadow-none transition-colors hover:border-ring active:scale-[0.99] focus:border-ring focus:outline-none focus-visible:ring-1 focus-visible:ring-ring', className, triggerClassName)}
          >
            <span className={cn(!selected && 'text-foreground-tertiary')}>{selected ? dayjs(selected).format('YYYY/MM/DD') : placeholder}</span>
            <span className="ml-3 inline-flex h-7 shrink-0 items-center justify-center text-foreground-tertiary transition-colors group-hover:text-foreground">
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange(dayjs(date).format('YYYY-MM-DD'))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
