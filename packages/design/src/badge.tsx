import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * Badge v2.1 changes:
 *  - default: `text-brand` (#00cd82 → 2.4:1 on white) → `text-brand-text`
 *    (#00875a → 5:1 on brand-muted). Same visual identity, AA-compliant.
 *  - warning: `text-warning` (4.1:1) → `text-warning-fg` (7.4:1).
 *  - bear: previously rendered with undefined `text-bear` (silent inheritance
 *    bug). Now an explicit token.
 *  - bull: still uses `text-bull`; with the bull/brand decoupling it sits
 *    safely on bull-bg (≥5:1).
 *  - transition tokenized.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors duration-fast ease-out focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-brand-muted text-brand-text [a]:hover:bg-brand-muted/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link:
          "text-brand-text underline-offset-4 hover:underline",
        bull:
          "bg-bull-bg text-bull [a]:hover:bg-bull-bg/80",
        bear:
          "bg-bear-bg text-bear [a]:hover:bg-bear-bg/80",
        warning:
          "bg-warning-bg text-warning-fg [a]:hover:bg-warning-bg/80",
        info:
          "bg-info-bg text-info [a]:hover:bg-info-bg/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
