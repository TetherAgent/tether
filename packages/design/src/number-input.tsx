import { ChevronDown, ChevronUp } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/utils'

type NumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  value: string | number | undefined
  onValueChange: (value: string) => void
  step?: number
  min?: number
  max?: number
  suffix?: React.ReactNode
  invalid?: boolean
  incrementLabel?: string
  decrementLabel?: string
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      className,
      value,
      onValueChange,
      step = 1,
      min,
      max,
      suffix,
      disabled,
      invalid = false,
      incrementLabel = '增加',
      decrementLabel = '减少',
      onBlur,
      onFocus,
      ...props
    },
    ref,
  ) => {
    const [draftValue, setDraftValue] = React.useState(
      value === null || value === undefined ? '' : String(value),
    )
    const [isFocused, setIsFocused] = React.useState(false)

    React.useEffect(() => {
      if (!isFocused) {
        setDraftValue(value === null || value === undefined ? '' : String(value))
      }
    }, [isFocused, value])

    const normalize = (next: number) => {
      if (typeof min === 'number' && next < min) {
        return min
      }
      if (typeof max === 'number' && next > max) {
        return max
      }
      return next
    }

    const shift = (direction: 1 | -1) => {
      const current = Number(draftValue || value || 0)
      const next = normalize(current + step * direction)
      const nextValue = String(Number(next.toFixed(10)))
      setDraftValue(nextValue)
      onValueChange(nextValue)
    }

    return (
      <div
        className={cn(
          'flex h-9 w-full overflow-hidden rounded-md border border-input bg-field transition-colors duration-fast ease-out hover:border-ring focus-within:border-ring focus-within:ring-1 focus-within:ring-ring data-[invalid=true]:border-bear data-[invalid=true]:ring-1 data-[invalid=true]:ring-bear/30',
          disabled && 'opacity-50 saturate-50',
          className,
        )}
        data-invalid={invalid || undefined}
      >
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={draftValue}
          disabled={disabled}
          onFocus={(event) => {
            setIsFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setIsFocused(false)
            setDraftValue(value === null || value === undefined ? '' : String(value))
            onBlur?.(event)
          }}
          onChange={(event) => {
            setDraftValue(event.target.value)
            onValueChange(event.target.value)
          }}
          data-invalid={invalid || undefined}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-base tabular-nums text-foreground outline-none placeholder:text-foreground-tertiary data-[invalid=true]:text-bear disabled:cursor-not-allowed md:text-sm"
          {...props}
        />
        {suffix && (
          <div className="flex shrink-0 items-center border-l border-border-subtle px-3 text-sm font-semibold text-foreground-tertiary">
            {suffix}
          </div>
        )}
        <div className="grid w-10 shrink-0 grid-rows-2 border-l border-border-subtle">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className="flex cursor-pointer items-center justify-center text-foreground-tertiary transition-colors duration-fast ease-out hover:bg-muted hover:text-foreground active:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground-tertiary"
            onClick={() => shift(1)}
            aria-label={incrementLabel}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className="flex cursor-pointer items-center justify-center border-t border-border-subtle text-foreground-tertiary transition-colors duration-fast ease-out hover:bg-muted hover:text-foreground active:bg-accent disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground-tertiary"
            onClick={() => shift(-1)}
            aria-label={decrementLabel}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  },
)
NumberInput.displayName = 'NumberInput'

export { NumberInput }
