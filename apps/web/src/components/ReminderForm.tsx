import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { Reminder, ReminderKind } from '../api/types';
import { isIsoDate } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { KIND_CONTEXT, KIND_LABELS, KINDS } from '../lib/reminderText';
import { TextArea, TextField } from './Field';

export interface ReminderFormValues {
  kind: ReminderKind;
  title: string;
  due_date: string | null;
  due_odometer: number | null;
  notes: string | null;
}

interface Props {
  initial?: Reminder;
  submitLabel: string;
  onSubmit: (values: ReminderFormValues) => Promise<void>;
  onCancel: () => void;
  serverIssues?: Record<string, string>;
}

type Errors = Partial<
  Record<'title' | 'due_date' | 'due_odometer' | 'notes' | 'due' | 'form', string>
>;

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateReminder(v: {
  kind: ReminderKind;
  title: string;
  due_date: string;
  due_odometer: string;
  notes: string;
}): Errors {
  const e: Errors = {};
  const title = v.title.trim();
  if (title.length < 1 || title.length > 200) e.title = 'Enter 1 to 200 characters.';
  if (
    v.due_date !== '' &&
    (!isIsoDate(v.due_date) || v.due_date < '2000-01-01' || v.due_date > '2200-12-31')
  )
    e.due_date = 'Enter a valid date between 2000 and 2200.';
  const km = v.due_odometer.trim();
  if (km !== '' && (!/^\d{1,8}$/.test(km) || Number(km) > 10_000_000))
    e.due_odometer = 'Enter whole kilometres, 0 to 10,000,000.';
  if (km !== '' && v.kind !== 'service')
    e.due_odometer = 'Only service reminders can have a due odometer.';
  if (v.due_date === '' && km === '') e.due = 'Enter a due date, a due odometer, or both.';
  if (v.notes.trim().length > 5000) e.notes = 'At most 5000 characters.';
  return e;
}

export function ReminderForm({ initial, submitLabel, onSubmit, onCancel, serverIssues }: Props) {
  const [kind, setKind] = useState<ReminderKind>(initial?.kind ?? 'service');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [dueKm, setDueKm] = useState(
    initial?.due_odometer != null ? String(initial.due_odometer) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateReminder({ kind, title, due_date: dueDate, due_odometer: dueKm, notes });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await onSubmit({
        kind,
        title: title.trim(),
        due_date: dueDate === '' ? null : dueDate,
        due_odometer: dueKm.trim() === '' ? null : Number(dueKm),
        notes: notes.trim() === '' ? null : notes.trim(),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const i = issuesByField(err.details);
        setErrors({
          title: i.title,
          due_date: i.due_date,
          due_odometer: i.due_odometer,
          notes: i.notes,
          form: err.message,
        });
      } else setErrors({ form: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  const si = serverIssues ?? {};
  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className="field">
        <label htmlFor="kind">Kind</label>
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ReminderKind);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
              {KIND_CONTEXT[k] ? ` (${KIND_CONTEXT[k] ?? ''})` : ''}
            </option>
          ))}
        </select>
        {kind === 'road_tax_renewal' ? (
          <p className="hint">
            Road tax (JPJ) is a label only. This app does not contact JPJ and does not know any fees
            or renewal periods. Enter the date you want to be reminded.
          </p>
        ) : null}
      </div>
      <TextField
        id="title"
        label="Title"
        required
        autoComplete="off"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
        error={errors.title ?? si.title}
      />
      {errors.due ? (
        <p className="error" role="alert">
          {errors.due}
        </p>
      ) : null}
      <TextField
        id="due_date"
        label="Due date"
        type="date"
        value={dueDate}
        onChange={(e) => {
          setDueDate(e.target.value);
        }}
        error={errors.due_date ?? si.due_date}
      />
      {kind === 'service' ? (
        <TextField
          id="due_odometer"
          label="Due odometer (km)"
          inputMode="numeric"
          autoComplete="off"
          value={dueKm}
          onChange={(e) => {
            setDueKm(e.target.value);
          }}
          error={errors.due_odometer ?? si.due_odometer}
        />
      ) : null}
      <TextArea
        id="notes"
        label="Notes"
        rows={3}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
        error={errors.notes ?? si.notes}
      />
      {errors.form ? (
        <p role="alert" className="error">
          {errors.form}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
