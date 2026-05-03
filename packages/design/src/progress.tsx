"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "./lib/utils"

function Progress({
  className,
  children,
  value,
  complete,
  total,
  tone,
  ...props
}: Omit<ProgressPrimitive.Root.Props, "value"> & {
  value?: number
  complete?: number
  total?: number
  tone?: "brand" | "bull" | "bear" | "warning" | string
}) {
  const resolvedValue = value ?? (typeof complete === "number" && typeof total === "number" && total > 0 ? (complete / total) * 100 : value)

  return (
    <ProgressPrimitive.Root
      value={resolvedValue ?? null}
      data-slot="progress"
      data-tone={tone}
      className={cn("group/progress flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full bg-primary transition-[width,background-color] duration-base ease-out group-data-[tone=bull]/progress:bg-bull group-data-[tone=bear]/progress:bg-bear group-data-[tone=warning]/progress:bg-warning",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-sm text-muted-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
