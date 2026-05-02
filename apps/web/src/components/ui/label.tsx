import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '../../lib/utils.js';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-normal leading-none text-[hsl(var(--muted-foreground))]', className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
