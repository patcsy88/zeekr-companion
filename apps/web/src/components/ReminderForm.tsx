import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { CoverType, Reminder, ReminderKind } from '../api/types';
import { isIsoDate } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen, senToInput } from '../lib/money';
import {
  COVER_LABELS,
  COVER_TYPES,
  KIND_CONTEXT,
  KIND_LABELS,
  KINDS,
  RENEWAL_PRIVACY,
} from '../lib/reminderText';
import { ACTIONS, ERROR, FORM, HINT, SelectField, TextArea, TextField } from './Field';
import { Button } from './ui/button';

export interface ReminderFormValues {
  kind: ReminderKind;
  title: string;
  due_date: string | null;
  due_odometer: number | null;
  notes: string | null;
  insurer: string | null;
  cover_type: CoverType | null;
  premium_minor: number | null;
  insurer_phone: string | null;
  amount_minor: number | null;
}

const MAX_RENEWAL_MINOR = 100_000_000;

interface Props {
  initial?: Reminder;
  prefill?: Partial<Pick<ReminderFormValues, 'title' | 'due_date' | 'due_odometer'>>;
  submitLabel: string;
  onSubmit: (values: ReminderFormValues) => Promise<void>;
  onCancel: () => void;
  serverIssues?: Record<string, string>;
}

type Errors = Partial<
  Record<
    | 'title'
    | 'due_date'
    | 'due_odometer'
    | 'notes'
    | 'due'
    | 'form'
    | 'insurer'
    | 'insurer_phone'
    | 'premium'
    | 'amount',
    string
  >
>;

function checkMoney(input: string): string | undefined {
  if (input.trim() === '') return undefined;
  const p = parseMyrToSen(input);
  if (!p.ok) return p.error;
  if (p.minor > MAX_RENEWAL_MINOR) return 'At most RM 1,000,000.00.';
  return undefined;
}

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateReminder(v: {
  kind: ReminderKind;
  title: string;
  due_date: string;
  due_odometer: string;
  notes: string;
  insurer?: string;
  insurer_phone?: string;
  premium?: string;
  amount?: string;
}): Errors {
  const e: Errors = {};
  if (v.kind === 'insurance_renewal') {
    if ((v.insurer ?? '').trim().length > 200) e.insurer = 'At most 200 characters.';
    if ((v.insurer_phone ?? '').trim().length > 30) e.insurer_phone = 'At most 30 characters.';
    e.premium = checkMoney(v.premium ?? '');
  }
  if (v.kind === 'road_tax_renewal') e.amount = checkMoney(v.amount ?? '');
  for (const k of ['premium', 'amount'] as const) if (e[k] === undefined) delete e[k];
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

export function ReminderForm({
  initial,
  prefill,
  submitLabel,
  onSubmit,
  onCancel,
  serverIssues,
}: Props) {
  const [kind, setKind] = useState<ReminderKind>(initial?.kind ?? 'service');
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? '');
  const [dueDate, setDueDate] = useState(initial?.due_date ?? prefill?.due_date ?? '');
  const startKm = initial?.due_odometer ?? prefill?.due_odometer ?? null;
  const [dueKm, setDueKm] = useState(startKm != null ? String(startKm) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [insurer, setInsurer] = useState(initial?.insurer ?? '');
  const [cover, setCover] = useState<CoverType | ''>(initial?.cover_type ?? '');
  const [premium, setPremium] = useState(
    initial?.premium_minor != null ? senToInput(initial.premium_minor) : '',
  );
  const [phone, setPhone] = useState(initial?.insurer_phone ?? '');
  const [amount, setAmount] = useState(
    initial?.amount_minor != null ? senToInput(initial.amount_minor) : '',
  );
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = validateReminder({
      kind,
      title,
      due_date: dueDate,
      due_odometer: dueKm,
      notes,
      insurer,
      insurer_phone: phone,
      premium,
      amount,
    });
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const insurance = kind === 'insurance_renewal';
    const money = (text: string): number | null => {
      const p = text.trim() === '' ? null : parseMyrToSen(text);
      return p?.ok ? p.minor : null;
    };
    setBusy(true);
    try {
      await onSubmit({
        insurer: insurance && insurer.trim() !== '' ? insurer.trim() : null,
        cover_type: insurance && cover !== '' ? cover : null,
        premium_minor: insurance ? money(premium) : null,
        insurer_phone: insurance && phone.trim() !== '' ? phone.trim() : null,
        amount_minor: kind === 'road_tax_renewal' ? money(amount) : null,
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
          insurer: i.insurer,
          insurer_phone: i.insurer_phone,
          premium: i.premium_minor,
          amount: i.amount_minor,
          form: err.message,
        });
      } else setErrors({ form: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  const si = serverIssues ?? {};
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className={FORM}>
      <SelectField
        id="kind"
        label="Kind"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as ReminderKind);
        }}
        extra={
          kind === 'road_tax_renewal' ? (
            <p className={HINT}>
              Road tax (JPJ) is a label only. This app does not contact JPJ and does not know any
              fees or renewal periods. Enter the date you want to be reminded.
            </p>
          ) : null
        }
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
            {KIND_CONTEXT[k] ? ` (${KIND_CONTEXT[k] ?? ''})` : ''}
          </option>
        ))}
      </SelectField>
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
        <p className={ERROR} role="alert">
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
      {kind === 'insurance_renewal' ? (
        <>
          <TextField
            id="insurer"
            label="Insurer"
            autoComplete="off"
            value={insurer}
            onChange={(e) => {
              setInsurer(e.target.value);
            }}
            error={errors.insurer ?? si.insurer}
          />
          <SelectField
            id="cover_type"
            label="Cover type"
            value={cover}
            onChange={(e) => {
              setCover(e.target.value as CoverType | '');
            }}
          >
            <option value="">Not set</option>
            {COVER_TYPES.map((c) => (
              <option key={c} value={c}>
                {COVER_LABELS[c]}
              </option>
            ))}
          </SelectField>
          <TextField
            id="premium"
            label="Premium (MYR)"
            inputMode="decimal"
            autoComplete="off"
            value={premium}
            onChange={(e) => {
              setPremium(e.target.value);
            }}
            error={errors.premium ?? si.premium_minor}
          />
          <TextField
            id="insurer_phone"
            label="Insurer phone"
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
            }}
            error={errors.insurer_phone ?? si.insurer_phone}
          />
        </>
      ) : null}
      {kind === 'road_tax_renewal' ? (
        <TextField
          id="amount"
          label="Amount (MYR)"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
          error={errors.amount ?? si.amount_minor}
        />
      ) : null}
      {kind !== 'service' ? (
        <p className={HINT} data-testid="renewal-privacy">
          {RENEWAL_PRIVACY}
        </p>
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
        <p role="alert" className={ERROR}>
          {errors.form}
        </p>
      ) : null}
      <div className={ACTIONS}>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
