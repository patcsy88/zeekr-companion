import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { TextArea, TextField } from '../components/Field';
import { BasisNote } from '../components/ReminderParts';
import { useConnectivity, useReminder } from '../data/hooks';
import { completeServiceNow } from '../data/mutations';
import { isIsoDate, klToday } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen } from '../lib/money';
import { isUuid, uuid } from '../lib/uuid';

type Errors = Partial<
  Record<'date' | 'odometer' | 'description' | 'cost' | 'provider' | 'notes' | 'form', string>
>;

export function CompleteServicePage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <CompleteService id={id} />;
}

function CompleteService({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useReminder(id);
  const { online } = useConnectivity();
  // One pair of ids per form visit, so pressing Save twice or retrying addresses the same rows.
  const ids = useMemo(() => ({ record_id: uuid(), next_id: uuid() }), []);
  const [date, setDate] = useState(klToday());
  const [odometer, setOdometer] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [cost, setCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) return <p>Reminder not found.</p>;
  const r = data.view.reminder;
  if (r.kind !== 'service' || r.completed_on !== null) {
    return (
      <section>
        <h1>Complete service</h1>
        <p>This reminder is not an open service reminder.</p>
        <Link to={`/reminders/${id}`}>Back</Link>
      </section>
    );
  }
  const odoValue = odometer ?? (data.basis ? String(data.basis.km) : '');
  const descValue = description ?? r.title;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!isIsoDate(date)) next.date = 'Enter a valid date.';
    if (!/^\d{1,8}$/.test(odoValue.trim()) || Number(odoValue) > 10_000_000)
      next.odometer = 'Enter whole kilometres, 0 to 10,000,000.';
    const desc = descValue.trim();
    if (desc.length < 1 || desc.length > 500) next.description = 'Enter 1 to 500 characters.';
    const money = parseMyrToSen(cost);
    if (!money.ok) next.cost = money.error;
    if (provider.trim().length > 200) next.provider = 'At most 200 characters.';
    if (notes.trim().length > 5000) next.notes = 'At most 5000 characters.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !money.ok) return;
    setBusy(true);
    try {
      await completeServiceNow(id, {
        ...ids,
        date,
        odometer: Number(odoValue),
        provider: provider.trim() === '' ? null : provider.trim(),
        description: desc,
        cost_minor: money.minor,
        notes: notes.trim() === '' ? null : notes.trim(),
      });
      void nav(`/reminders/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const issues = issuesByField(err.details);
        setErrors({
          date: issues.date,
          odometer: issues.odometer,
          description: issues.description,
          cost: issues.cost_minor,
          provider: issues.provider,
          notes: issues.notes,
          form: err.message,
        });
      } else {
        setErrors({ form: err instanceof Error ? err.message : 'Could not complete the service.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="cs-title">
      <h1 id="cs-title">Complete service</h1>
      <p className="muted">
        This records the service, marks “{r.title}” done and, for a suggested-schedule service,
        creates the next reminder (40,000 km or 24 months, whichever comes first).
      </p>
      <BasisNote basis={data.basis} />
      {online ? null : (
        <p role="status" className="error">
          Completing a service needs a connection.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          id="date"
          label="Service date"
          type="date"
          required
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
          }}
          error={errors.date}
        />
        <TextField
          id="odometer"
          label="Odometer (km)"
          inputMode="numeric"
          autoComplete="off"
          required
          value={odoValue}
          onChange={(e) => {
            setOdometer(e.target.value);
          }}
          error={errors.odometer}
        />
        <TextField
          id="provider"
          label="Service centre"
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
          value={descValue}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
          error={errors.description}
        />
        <TextField
          id="cost"
          label="Cost (MYR)"
          hint="In ringgit. 0 is fine, for example under warranty."
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
          <button type="submit" className="primary" disabled={busy || !online}>
            {busy ? 'Saving…' : 'Complete service'}
          </button>
          <button
            type="button"
            onClick={() => {
              void nav(`/reminders/${id}`);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
