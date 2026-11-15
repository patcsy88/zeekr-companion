// Copied from COSS UI (https://coss.com/ui, MIT). Edit here; there is no upstream sync.
// Trimmed: a native <textarea> inside the COSS frame (no Base UI Field), like Input's nativeInput.
import type * as React from 'react';
import { cn } from '../../lib/cn';

export type TextareaProps = React.ComponentPropsWithoutRef<'textarea'> &
  React.RefAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps): React.ReactElement {
  return (
    <span
      className="relative inline-grid w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] sm:text-sm dark:bg-input/32 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]"
      data-slot="textarea-control"
    >
      <textarea
        className={cn(
          'min-h-18.5 w-full rounded-[inherit] px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)] text-foreground outline-none placeholder:text-muted-foreground/72 max-sm:min-h-21.5',
          className,
        )}
        data-slot="textarea"
        {...props}
      />
    </span>
  );
}
