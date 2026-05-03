import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Button v2.1 changes:
 *  - `default` is now solid `bg-primary` (brand) — was gradient. The gradient
 *    moved to `brand` so we don't put brand-shadow on every form button.
 *  - `font-[var(--font-weight-button)]` → `font-button` utility (no arbitrary).
 *  - `transition-all` → `transition-colors duration-fast ease-out` (cheaper +
 *    matches the spec's transition rule).
 *  - new `xs` size = h-7 (28px) for dense table rows / inline actions.
 *  - `lg` raised to h-11 (44px) — meets mobile hit target.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-button whitespace-nowrap transition-colors duration-fast ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-brand-hover aria-expanded:bg-brand-hover",
        brand:
          "bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-90",
        outline:
          "border-border bg-background text-foreground font-medium hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "font-medium hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link:
          "font-medium text-brand-text underline-offset-4 hover:underline",
        primary:
          "bg-primary text-primary-foreground hover:bg-brand-hover [a]:hover:bg-brand-hover",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs:
          "h-7 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm:
          "h-8 gap-1 rounded-md px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg:
          "h-11 gap-1.5 rounded-lg px-5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9 rounded-full",
        "icon-xs":
          "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-md",
        "icon-lg": "size-11 rounded-full",
        actionIcon: "size-9 rounded-md p-0",
        link: "h-auto gap-1 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    children?: React.ReactNode
  }) {
  const child = asChild && React.isValidElement(children) ? children : undefined

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      render={child}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {asChild ? undefined : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
