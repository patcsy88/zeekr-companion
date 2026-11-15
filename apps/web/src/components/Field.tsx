import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

interface Common {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  extra?: ReactNode;
  /** Id of an element inside `extra` that should also describe the control. */
  extraId?: string;
}

function describedBy(id: string, hint?: string, error?: string | null, extraId?: string) {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : '', extraId ?? '']
    .filter(Boolean)
    .join(' ');
  return ids || undefined;
}

/** Hint text under a label or a control (COSS muted small text). */
export const HINT = 'm-0 text-muted-foreground text-sm';
/** A field error or form error line. */
export const ERROR = 'm-0 font-medium text-destructive-foreground text-sm';

/** Label, hint, control, error and any extra lines, with the ids the controls point at. */
export function FieldShell({
  id,
  label,
  hint,
  error,
  extra,
  children,
}: Omit<Common, 'extraId'> & { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p id={`${id}-hint`} className={HINT}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className={ERROR} role="alert">
          {error}
        </p>
      ) : null}
      {extra}
    </div>
  );
}

export function TextField({
  id,
  label,
  hint,
  error,
  extra,
  extraId,
  ...rest
}: Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} extra={extra}>
      <Input
        nativeInput
        size="lg"
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, extraId)}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextArea({
  id,
  label,
  hint,
  error,
  extra,
  extraId,
  ...rest
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} extra={extra}>
      <Textarea
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, extraId)}
        {...rest}
      />
    </FieldShell>
  );
}

/** The COSS input frame, reused around a native select (keeps the iOS picker wheel). */
const SELECT_FRAME =
  'relative inline-flex w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base shadow-xs/5 ring-ring/24 transition-shadow has-focus-visible:border-ring has-focus-visible:ring-[3px] has-aria-invalid:border-destructive/64 has-disabled:opacity-64 dark:bg-input/32';

/** A native <select> in the COSS input frame, with a chevron. No label: see SelectField. */
export function Select({ children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={SELECT_FRAME} data-slot="select-control">
      <select
        className="h-9.5 w-full min-w-0 appearance-none rounded-[inherit] border-0 bg-transparent ps-[calc(--spacing(3)-1px)] pe-9 text-foreground outline-none [font:inherit]"
        data-slot="select"
        {...rest}
      >
        {children}
      </select>
      {/* A CSS chevron, not an <svg>: tests check that no <svg> appears in page content. */}
      <span
        className="pointer-events-none absolute end-3.5 top-1/2 size-2 -translate-y-3/4 rotate-45 border-muted-foreground border-e-2 border-b-2"
        aria-hidden="true"
      />
    </span>
  );
}

/** A labelled native select with hint and error, wired like TextField. */
export function SelectField({
  id,
  label,
  hint,
  error,
  extra,
  extraId,
  name,
  children,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} extra={extra}>
      <Select
        id={id}
        name={name ?? id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, extraId)}
        {...rest}
      >
        {children}
      </Select>
    </FieldShell>
  );
}

/** The column of fields in a form. */
export const FORM = 'flex flex-col gap-5';
/** The row of buttons under a form. */
export const ACTIONS = 'flex flex-wrap items-center gap-2';
