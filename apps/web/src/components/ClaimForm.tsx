import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { ClaimStatus, WarrantyClaim, WarrantyCoverage } from '../api/types';
import { DEFAULT_DATE_HINT, isIsoDate, klToday } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen, senToInput } from '../lib/money';
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES } from '../lib/warrantyText';
import { TextArea, TextField } from './Field';

export interface ClaimFormValues {
  date: string;
  odometer: number;
  description: string;
  status: ClaimStatus;
  cost_covered_minor: number | null;
  notes: string | null;
}

interface Props {
  coverage: Pick<WarrantyCoverage, 'start_date' | 'end_date'>;
  initial?: WarrantyClaim;
  submitLabel: string;
  onSubmit: (values: ClaimFormValues) => Promise<void>;
  onCancel: () => void;
  serverIssues?: Record<string, string>;
}

type Errors = Partial<
  Record<'date' | 'odometer' | 'description' | 'cost' | 'notes' | 'form', string>
>;

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateClaim(
  v: { date: string; odometer: string; description: string; cost: string; notes: string },
  today: string = klToday(),
): Errors & { costMinor?: number | null } {
  const e: Errors & { costMinor?: number | null } = {};
  if (!isIsoDate(v.date) || v.date < '2000-01-01') e.date = 'Enter a valid date from 2000.';
  else if (v.date > today) e.date = 'The date cannot be in the future (Malaysia date).';
  const km = v.odometer.trim();
  if (!/^\d{1,8}$/.test(km) || Number(km) > 10_000_000)
    e.odometer = 'Enter whole kilometres, 0 to 10,000,000.';
  const d = v.description.trim();
  if (d.length < 1 || d.length > 500) e.description = 'Enter 1 to 500 characters.';
  if (v.cost.trim() === '') e.costMinor = null;
  else {
    const money = parseMyrToSen(v.cost);
    if (!money.ok) e.cost = money.error;
    else e.costMinor = money.minor;
  }
  if (v.notes.trim().length > 5000) e.notes = 'At most 5000 characters.';
  return e;
}

/** Hint only (never an error): the server accepts a claim date outside the coverage dates. */
export function outsideCoverageDates(
  date: string,
  c: Pick<WarrantyCoverage, 'start_date' | 'end_date'>,
): boolean {
  if (!isIsoDate(date)) return false;
  return date < c.start_date || (c.end_date !== null && date > c.end_date);
}

export function ClaimForm({
  coverage,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  serverIssues,
}: Props) {
  const [date, setDate] = useState(initial?.date ?? klToday());
  const [odo, setOdo] = useState(initial ? String(initial.odometer) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<ClaimStatus>(initial?.status ?? 'submitted');
  const [cost, setCost] = useState(
    initial?.cost_covered_minor != null ? senToInput(initial.cost_covered_minor) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { costMinor, ...next } = validateClaim({
      date,
      odometer: odo,
      description,
      cost,
      notes,
    });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await onSubmit({
        date,
        odometer: Number(odo.trim()),
        description: description.trim(),
        status,
        cost_covered_minor: costMinor ?? null,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const i = issuesByField(err.details);
        setErrors({
          date: i.date,
          odometer: i.odometer,
          description: i.description,
          cost: i.cost_covered_minor,
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
      <TextField
        id="date"
        label="Claim date"
        type="date"
        required
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
        }}
        error={errors.date ?? si.date}
        extraId="date-hints"
        extra={
          <div id="date-hints">
            <p className="hint">{DEFAULT_DATE_HINT}</p>
            {outsideCoverageDates(date, coverage) ? (
              <p className="hint" data-testid="claim-date-hint">
                This date is outside the dates you entered for this coverage. You can still save it.
              </p>
            ) : null}
          </div>
        }
      />
      <TextField
        id="odometer"
        label="Odometer (km)"
        inputMode="numeric"
        autoComplete="off"
        required
        value={odo}
        onChange={(e) => {
          setOdo(e.target.value);
        }}
        error={errors.odometer ?? si.odometer}
        hint="A claim does not change the current odometer."
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
        error={errors.description ?? si.description}
      />
      <div className="field">
        <label htmlFor="claim_status">Claim status</label>
        <select
          id="claim_status"
          name="claim_status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ClaimStatus);
          }}
        >
          {CLAIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CLAIM_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="cost"
        label="Cost covered (MYR)"
        hint="Optional. A record only: it is not an expense and changes no totals."
        inputMode="decimal"
        autoComplete="off"
        value={cost}
        onChange={(e) => {
          setCost(e.target.value);
        }}
        error={errors.cost ?? si.cost_covered_minor}
      />
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
