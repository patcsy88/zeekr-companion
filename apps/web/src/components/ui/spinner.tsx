// From COSS UI (https://coss.com/ui, MIT), with the lucide-react icon replaced by its inline SVG.
import type React from 'react';
import { cn } from '../../lib/cn';

export function Spinner({ className, ...props }: React.ComponentProps<'svg'>): React.ReactElement {
  return (
    <svg
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      role="status"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
