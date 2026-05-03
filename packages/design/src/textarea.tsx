import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Textarea v2.1 — surface + transition aligned with Input v2.1.
 * iOS zoom prevention via `text-base md:text-sm` retained intentionally.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-lg border border-input bg-field px-3 py-2 text-base transition-colors duration-fast ease-out outline-none",
        "placeholder:text-foreground-tertiary",
        "focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "md:text-sm",
        "dark:bg-input/30 dark:focus-visible:bg-card dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
