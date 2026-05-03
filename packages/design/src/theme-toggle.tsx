import { Moon, Sun } from 'lucide-react'
import * as React from 'react'

import { Button } from './button'

type ThemeToggleProps = Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children' | 'aria-label'> & {
  isDark: boolean
  onToggle: () => void
  'aria-label'?: string
}

function ThemeToggle({ isDark, onToggle, 'aria-label': ariaLabel = '切换主题', ...props }: ThemeToggleProps) {
  return (
    <Button variant="secondary" size="icon" onClick={onToggle} aria-label={ariaLabel} title={ariaLabel} {...props}>
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  )
}

export { ThemeToggle }
