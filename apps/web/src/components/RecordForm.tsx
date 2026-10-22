import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { ServiceRecord } from '../api/types';
import { DEFAULT_DATE_HINT, isIsoDate, klToday } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen, senToInput } from '../lib/money';
import { TextArea, TextField } from './Field';

export interface RecordFormValues {
  date: string;
  odometer: number;
  provider: string | null;
  description: string;
  cost_minor: number;
  notes: string | null;
}

interface Props {
  initial?: ServiceRecord;
  submitLabel: string;
  onSubmit: (values: RecordFormValues) => Promise<void>;
  onCancel: () => void;
  /** Server-side field errors from an earlier failed sync of this record. */
  serverIssues?: Record<string, string>;
}

type Errors = Partial<
  Record<'date' | 'odometer' | 'description' | 'cost' | 'provider' | 'notes' | 'form', string>
>;

export function RecordForm({ initial, submitLabel, onSubmit, onCancel, serverIssues }: Props) {
  const [date, setDate] = useState(
    // Owner decision 2026-10-22: dates are judged against the Asia/Kuala_Lumpur date, so the
    // default is that date. A stored date is shown exactly as stored.
    initial?.date ?? klToday(),
  );
  const [odometer, setOdometer] = useState(initial ? String(initial.odometer) : '');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cost, setCost] = useState(initial ? senToInput(initial.cost_minor) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [serverDate, setServerDate] = useState<string | undefined>(serverIssues?.date);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!isIsoDate(date)) next.date = 'Enter a valid date.';
    if (!/^\d{1,8}$/.test(odometer.trim()) || Number(odometer) > 10_000_000)
      next.odometer = 'Enter whole kilometres, 0 to 10,000,000.';
    const desc = description.trim();
    if (desc.length < 1 || desc.length > 500) next.description = 'Enter 1 to 500 characters.';
    const money = parseMyrToSen(cost);
    if (!money.ok) next.cost = money.error;
    if (provider.trim().length > 200) next.provider = 'At most 200 characters.';
    if (notes.trim().length > 5000) next.notes = 'At most 5000 characters.';
    setErrors(next);
    setServerDate(undefined);
    if (Object.keys(next).length > 0 || !money.ok) return;

    setBusy(true);
    try {
      await onSubmit({
        date,
        odometer: Number(odometer),
        provider: provider.trim() === '' ? null : provider.trim(),
        description: desc,
        cost_minor: money.minor,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const issues = issuesByField(err.details);
        setServerDate(issues.date);
        setErrors({
          odometer: issues.odometer,
          description: issues.description,
          cost: issues.cost_minor,
          provider: issues.provider,
          notes: issues.notes,
          form: issues.date ? undefined : err.message,
        });
      } else {
        setErrors({ form: err instanceof Error ? err.message : 'Could not save.' });
      }
    } finally {
      setBusy(false);
    }
  }

  const sd = serverDate ?? serverIssues?.date;
  const dateError = errors.date ?? (sd ? `The server rejected this date: ${sd}.` : null);

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <TextField
        id="date"
        label="Date"
        type="date"
        required
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
        }}
        error={dateError}
        extraId="date-hint-default"
        extra={
          <>
            <p className="hint" id="date-hint-default" data-testid="date-default-hint">
              {DEFAULT_DATE_HINT}
            </p>
          </>
        }
      />
      <TextField
        id="odometer"
        label="Odometer (km)"
        inputMode="numeric"
        autoComplete="off"
        required
        value={odometer}
        onChange={(e) => {
          setOdometer(e.target.value);
        }}
        error={errors.odometer}
      />
      <TextField
        id="provider"
        label="Provider"
        autoComplete="off"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value);
        }}
        error={errors.provider}
      />
      <TextArea
        id="description"
        label="Description"
        rows={3}
        required
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
        error={errors.description}
      />
      <TextField
        id="cost"
        label="Cost (MYR)"
        hint="In ringgit, for example 120.50."
        inputMode="decimal"
        autoComplete="off"
        required
        value={cost}
        onChange={(e) => {
          setCost(e.target.value);
        }}
        error={errors.cost}
      />
      <TextArea
        id="notes"
        label="Notes"
        rows={3}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
        error={errors.notes}
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
