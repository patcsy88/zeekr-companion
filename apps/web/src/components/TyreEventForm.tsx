import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { TyreEvent, TyreKind, TyreWheel } from '../api/types';
import { DEFAULT_DATE_HINT, isIsoDate, klToday } from '../lib/dates';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen, senToInput } from '../lib/money';
import { KIND_LABELS, MAX_SIZE, TYRE_KINDS, WHEEL_LABELS, WHEELS } from '../lib/tyreText';
import { TextArea, TextField } from './Field';

export interface TyreEventFormValues {
  date: string;
  kind: TyreKind;
  wheels: TyreWheel[];
  odometer: number;
  brand: string | null;
  model: string | null;
  size: string | null;
  cost_minor: number | null;
  shop: string | null;
  notes: string | null;
}

interface Props {
  initial?: TyreEvent;
  /** New events only: the current odometer (T5) and the vehicle tyre specification (T6). */
  prefill?: { odometer: number | null; size: string | null };
  submitLabel: string;
  onSubmit: (values: TyreEventFormValues) => Promise<void>;
  onCancel: () => void;
  /** Server-side field errors from an earlier failed sync of this event. */
  serverIssues?: Record<string, string>;
}

type Field =
  | 'date'
  | 'kind'
  | 'wheels'
  | 'odometer'
  | 'brand'
  | 'model'
  | 'size'
  | 'cost'
  | 'shop'
  | 'notes'
  | 'form';
type Errors = Partial<Record<Field, string>>;

interface Raw {
  date: string;
  kind: string;
  wheels: string[];
  odometer: string;
  brand: string;
  model: string;
  size: string;
  cost: string;
  shop: string;
  notes: string;
}

function blank(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateTyreEvent(
  v: Raw,
  today: string = klToday(),
): Errors & { values?: TyreEventFormValues } {
  const e: Errors = {};
  if (!isIsoDate(v.date) || v.date < '2000-01-01') e.date = 'Enter a valid date from 2000.';
  else if (v.date > today) e.date = 'The date cannot be in the future (Malaysia date).';
  if (!(TYRE_KINDS as string[]).includes(v.kind)) e.kind = 'Choose a type.';
  const wheels = WHEELS.filter((w) => v.wheels.includes(w));
  if (wheels.length === 0) e.wheels = 'Tick at least one wheel.';
  const km = v.odometer.trim();
  if (!/^\d{1,8}$/.test(km) || Number(km) > 10_000_000)
    e.odometer = 'Enter whole kilometres, 0 to 10,000,000.';
  const replace = v.kind === 'replace';
  if (replace && v.brand.trim().length > 100) e.brand = 'At most 100 characters.';
  if (replace && v.model.trim().length > 100) e.model = 'At most 100 characters.';
  if (replace && v.size.trim().length > MAX_SIZE) e.size = `At most ${MAX_SIZE} characters.`;
  let cost: number | null = null;
  if (v.cost.trim() !== '') {
    const money = parseMyrToSen(v.cost);
    if (!money.ok) e.cost = money.error;
    else cost = money.minor;
  }
  if (v.shop.trim().length > 200) e.shop = 'At most 200 characters.';
  if (v.notes.trim().length > 5000) e.notes = 'At most 5000 characters.';
  if (Object.keys(e).length > 0) return e;
  return {
    values: {
      date: v.date,
      kind: v.kind as TyreKind,
      wheels,
      odometer: Number(km),
      // Brand, model and size describe a fitted tyre, so only a Replace keeps them (AC-76).
      brand: replace ? blank(v.brand) : null,
      model: replace ? blank(v.model) : null,
      size: replace ? blank(v.size) : null,
      cost_minor: cost,
      shop: blank(v.shop),
      notes: blank(v.notes),
    },
  };
}

export function TyreEventForm({
  initial,
  prefill,
  submitLabel,
  onSubmit,
  onCancel,
  serverIssues,
}: Props) {
  const [date, setDate] = useState(initial?.date ?? klToday());
  const [kind, setKind] = useState<TyreKind>(initial?.kind ?? 'replace');
  // T4: all four wheels are ticked by default.
  const [wheels, setWheels] = useState<TyreWheel[]>(initial?.wheels ?? [...WHEELS]);
  const startKm = initial?.odometer ?? prefill?.odometer ?? null;
  const [odometer, setOdometer] = useState(startKm !== null ? String(startKm) : '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const startSize =
    initial !== undefined
      ? (initial.size ?? '')
      : prefill?.size != null && prefill.size.length <= MAX_SIZE
        ? prefill.size
        : '';
  const [size, setSize] = useState(startSize);
  const [cost, setCost] = useState(
    initial?.cost_minor != null ? senToInput(initial.cost_minor) : '',
  );
  const [shop, setShop] = useState(initial?.shop ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  // The odometer and the vehicle can arrive after the form first shows (a first visit). Fill them in
  // then, unless the owner has already typed in that field.
  const touched = useRef({ odometer: false, size: false });
  const lateKm = initial === undefined ? (prefill?.odometer ?? null) : null;
  const lateSize =
    initial === undefined && prefill?.size != null && prefill.size.length <= MAX_SIZE
      ? prefill.size
      : null;
  useEffect(() => {
    if (lateKm !== null && !touched.current.odometer) setOdometer(String(lateKm));
  }, [lateKm]);
  useEffect(() => {
    if (lateSize !== null && !touched.current.size) setSize(lateSize);
  }, [lateSize]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { values, ...next } = validateTyreEvent({
      date,
      kind,
      wheels,
      odometer,
      brand,
      model,
      size,
      cost,
      shop,
      notes,
    });
    setErrors(next);
    if (values === undefined) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const i = issuesByField(err.details);
        setErrors({
          date: i.date,
          kind: i.kind,
          wheels: i.wheels,
          odometer: i.odometer,
          brand: i.brand,
          model: i.model,
          size: i.size,
          cost: i.cost_minor,
          shop: i.shop,
          notes: i.notes,
          form: err.message,
        });
      } else setErrors({ form: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  const si = serverIssues ?? {};
  const wheelError = errors.wheels ?? si.wheels;
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
        error={errors.date ?? (si.date ? `The server rejected this date: ${si.date}.` : null)}
        extraId="date-hint-default"
        extra={
          <p className="hint" id="date-hint-default">
            {DEFAULT_DATE_HINT}
          </p>
        }
      />
      <div className="field">
        <label htmlFor="kind">Type</label>
        <select
          id="kind"
          name="kind"
          value={kind}
          aria-invalid={(errors.kind ?? si.kind) ? true : undefined}
          onChange={(e) => {
            setKind(e.target.value as TyreKind);
          }}
        >
          {TYRE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {(errors.kind ?? si.kind) ? (
          <p className="error" role="alert">
            {errors.kind ?? si.kind}
          </p>
        ) : null}
      </div>
      <fieldset aria-describedby={wheelError ? 'wheels-error' : undefined}>
        <legend>Wheels</legend>
        {WHEELS.map((w) => (
          <label key={w} className="check">
            <input
              type="checkbox"
              name="wheels"
              value={w}
              checked={wheels.includes(w)}
              onChange={(e) => {
                setWheels(e.target.checked ? [...wheels, w] : wheels.filter((x) => x !== w));
              }}
            />{' '}
            {WHEEL_LABELS[w]}
          </label>
        ))}
        {kind === 'rotate' ? (
          <p className="muted small">
            Tick the wheels that were moved. Write the swap pattern in the notes if you want to keep
            it.
          </p>
        ) : null}
        {wheelError ? (
          <p id="wheels-error" className="error" role="alert">
            {wheelError}
          </p>
        ) : null}
      </fieldset>
      <TextField
        id="odometer"
        label="Odometer (km)"
        hint={
          initial === undefined && prefill?.odometer != null
            ? 'Filled in with the current odometer. Change it if the work was done at another reading.'
            : undefined
        }
        inputMode="numeric"
        autoComplete="off"
        required
        value={odometer}
        onChange={(e) => {
          touched.current.odometer = true;
          setOdometer(e.target.value);
        }}
        error={errors.odometer ?? si.odometer}
      />
      {kind === 'replace' ? (
        <>
          <TextField
            id="brand"
            label="Brand, optional"
            autoComplete="off"
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
            }}
            error={errors.brand ?? si.brand}
          />
          <TextField
            id="model"
            label="Model, optional"
            autoComplete="off"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
            }}
            error={errors.model ?? si.model}
          />
          <TextField
            id="size"
            label="Size, optional"
            hint="For example 255/45 R20."
            autoComplete="off"
            value={size}
            onChange={(e) => {
              touched.current.size = true;
              setSize(e.target.value);
            }}
            error={errors.size ?? si.size}
          />
        </>
      ) : null}
      <TextField
        id="cost"
        label="Cost (MYR), optional"
        hint="In ringgit, for example 1200.00. Not added to Expenses."
        inputMode="decimal"
        autoComplete="off"
        value={cost}
        onChange={(e) => {
          setCost(e.target.value);
        }}
        error={errors.cost ?? si.cost_minor}
      />
      <TextField
        id="shop"
        label="Shop, optional"
        autoComplete="off"
        value={shop}
        onChange={(e) => {
          setShop(e.target.value);
        }}
        error={errors.shop ?? si.shop}
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
