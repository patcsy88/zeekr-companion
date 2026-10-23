import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { ProviderType, VerificationStatus, WarrantyCoverage } from '../api/types';
import { isIsoDate } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import {
  SOURCE_NOTE_WARNING,
  TYPE_LABELS,
  TYPES,
  VERIFICATION_LABELS,
  VERIFICATIONS,
} from '../lib/warrantyText';
import { TextArea, TextField } from './Field';

export interface CoverageFormValues {
  name: string;
  provider_type: ProviderType;
  start_date: string;
  end_date: string | null;
  km_limit: number | null;
  notes: string | null;
  verification_status: VerificationStatus;
  source_note: string | null;
}

interface Props {
  initial?: WarrantyCoverage;
  submitLabel: string;
  onSubmit: (values: CoverageFormValues) => Promise<void>;
  onCancel: () => void;
  serverIssues?: Record<string, string>;
}

type Errors = Partial<
  Record<
    'name' | 'start_date' | 'end_date' | 'km_limit' | 'notes' | 'source_note' | 'limit' | 'form',
    string
  >
>;

const inRange = (d: string) => isIsoDate(d) && d >= '2000-01-01' && d <= '2200-12-31';

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateCoverage(v: {
  name: string;
  start_date: string;
  end_date: string;
  km_limit: string;
  notes: string;
  source_note: string;
}): Errors {
  const e: Errors = {};
  const name = v.name.trim();
  if (name.length < 1 || name.length > 200) e.name = 'Enter 1 to 200 characters.';
  if (!inRange(v.start_date)) e.start_date = 'Enter a valid start date between 2000 and 2200.';
  if (v.end_date !== '' && !inRange(v.end_date))
    e.end_date = 'Enter a valid date between 2000 and 2200.';
  else if (v.end_date !== '' && inRange(v.start_date) && v.end_date < v.start_date)
    e.end_date = 'The end date cannot be before the start date.';
  const km = v.km_limit.trim();
  if (km !== '' && (!/^\d{1,8}$/.test(km) || Number(km) < 1 || Number(km) > 10_000_000))
    e.km_limit = 'Enter whole kilometres, 1 to 10,000,000.';
  if (v.end_date === '' && km === '') e.limit = 'Enter an end date, a km limit, or both.';
  if (v.notes.trim().length > 5000) e.notes = 'At most 5000 characters.';
  if (v.source_note.trim().length > 200) e.source_note = 'At most 200 characters.';
  return e;
}

export function CoverageForm({ initial, submitLabel, onSubmit, onCancel, serverIssues }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<ProviderType>(initial?.provider_type ?? 'extended');
  const [start, setStart] = useState(initial?.start_date ?? '');
  const [end, setEnd] = useState(initial?.end_date ?? '');
  const [km, setKm] = useState(initial?.km_limit != null ? String(initial.km_limit) : '');
  const [ver, setVer] = useState<VerificationStatus>(initial?.verification_status ?? 'unverified');
  const [sourceNote, setSourceNote] = useState(initial?.source_note ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateCoverage({
      name,
      start_date: start,
      end_date: end,
      km_limit: km,
      notes,
      source_note: sourceNote,
    });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        provider_type: type,
        start_date: start,
        end_date: end === '' ? null : end,
        km_limit: km.trim() === '' ? null : Number(km),
        notes: notes.trim() === '' ? null : notes.trim(),
        verification_status: ver,
        source_note: sourceNote.trim() === '' ? null : sourceNote.trim(),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const i = issuesByField(err.details);
        setErrors({
          name: i.name,
          start_date: i.start_date,
          end_date: i.end_date,
          km_limit: i.km_limit,
          notes: i.notes,
          source_note: i.source_note,
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
        id="name"
        label="Name"
        required
        autoComplete="off"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        error={errors.name ?? si.name}
      />
      <div className="field">
        <label htmlFor="provider_type">Type</label>
        <select
          id="provider_type"
          name="provider_type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as ProviderType);
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="start_date"
        label="Start date"
        type="date"
        required
        value={start}
        onChange={(e) => {
          setStart(e.target.value);
        }}
        error={errors.start_date ?? si.start_date}
      />
      {(errors.limit ?? si.body) ? (
        <p className="error" role="alert">
          {errors.limit ?? si.body}
        </p>
      ) : null}
      <TextField
        id="end_date"
        label="End date"
        type="date"
        value={end}
        onChange={(e) => {
          setEnd(e.target.value);
        }}
        error={errors.end_date ?? si.end_date}
      />
      <TextField
        id="km_limit"
        label="Km limit"
        hint="Compared with your current odometer, not with km since the start date."
        inputMode="numeric"
        autoComplete="off"
        value={km}
        onChange={(e) => {
          setKm(e.target.value);
        }}
        error={errors.km_limit ?? si.km_limit}
      />
      <div className="field">
        <label htmlFor="verification_status">Verification status</label>
        <select
          id="verification_status"
          name="verification_status"
          value={ver}
          onChange={(e) => {
            setVer(e.target.value as VerificationStatus);
          }}
        >
          {VERIFICATIONS.map((v) => (
            <option key={v} value={v}>
              {VERIFICATION_LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="source_note"
        label="Source note"
        hint={`Where these dates and limits come from. ${SOURCE_NOTE_WARNING}`}
        autoComplete="off"
        value={sourceNote}
        onChange={(e) => {
          setSourceNote(e.target.value);
        }}
        error={errors.source_note ?? si.source_note}
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
