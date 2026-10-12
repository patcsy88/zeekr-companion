import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

interface Common {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
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

export function TextField({
  id,
  label,
  hint,
  error,
  extra,
  extraId,
  ...rest
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, extraId)}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      ) : null}
      {extra}
    </div>
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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, extraId)}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      ) : null}
      {extra}
    </div>
  );
}
