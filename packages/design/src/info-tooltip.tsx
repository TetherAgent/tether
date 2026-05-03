import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { ReactNode } from "react"

import { cn } from "./lib/utils"

interface InfoTooltipProps {
  content: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function InfoTooltip({
  content,
  children,
  className,
  contentClassName,
}: InfoTooltipProps) {
  if (!content) {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        render={
          <span
            tabIndex={0}
            className={cn(
              "inline-flex w-fit cursor-default items-center outline-none",
              className,
            )}
          >
            {children}
          </span>
        }
      />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side="bottom"
          sideOffset={8}
          className="isolate z-[140]"
        >
          <TooltipPrimitive.Popup
            data-slot="info-tooltip-content"
            className={cn(
              "min-w-[220px] max-w-[min(320px,calc(100vw-32px))] origin-(--transform-origin) whitespace-normal rounded-md border border-border-subtle bg-card px-3 py-2 text-left text-sm font-medium leading-relaxed text-foreground shadow-card data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              contentClassName,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
