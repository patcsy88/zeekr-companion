import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { Expense, ExpenseCategory } from '../api/types';
import { DEFAULT_DATE_HINT, isIsoDate, klToday } from '../lib/dates';
import { CATEGORIES, CATEGORY_LABELS } from '../lib/expenseText';
import { parseKwhToWh, whToInput } from '../lib/energy';
import { issuesByField } from '../lib/forms';
import { parseMyrToSen, senToInput } from '../lib/money';
import { TextArea, TextField } from './Field';

export interface ExpenseFormValues {
  date: string;
  category: ExpenseCategory;
  amount_minor: number;
  notes: string | null;
  energy_wh: number | null;
}

interface Props {
  initial?: Expense;
  submitLabel: string;
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
  onCancel: () => void;
  /** Server-side field errors from an earlier failed sync of this expense. */
  serverIssues?: Record<string, string>;
}

type Errors = Partial<Record<'date' | 'category' | 'amount' | 'energy' | 'notes' | 'form', string>>;

/** Checks the same rules as the server so most mistakes never leave the device. */
export function validateExpense(
  v: { date: string; category: string; amount: string; notes: string; energy?: string },
  today: string = klToday(),
): Errors & { minor?: number; wh?: number | null } {
  const e: Errors & { minor?: number; wh?: number | null } = {};
  if (v.category === 'charging') {
    const energy = parseKwhToWh(v.energy ?? '');
    if (!energy.ok) e.energy = energy.error;
    else e.wh = energy.wh;
  } else e.wh = null;
  if (!isIsoDate(v.date) || v.date < '2000-01-01') e.date = 'Enter a valid date from 2000.';
  else if (v.date > today) e.date = 'The date cannot be in the future (Malaysia date).';
  if (!(CATEGORIES as string[]).includes(v.category)) e.category = 'Choose a category.';
  const money = parseMyrToSen(v.amount);
  if (!money.ok) e.amount = money.error;
  else if (money.minor < 1) e.amount = 'The amount must be more than RM 0.00.';
  else e.minor = money.minor;
  if (v.notes.trim().length > 5000) e.notes = 'At most 5000 characters.';
  return e;
}

export function ExpenseForm({ initial, submitLabel, onSubmit, onCancel, serverIssues }: Props) {
  const [date, setDate] = useState(initial?.date ?? klToday());
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'charging');
  const [amount, setAmount] = useState(initial ? senToInput(initial.amount_minor) : '');
  const [energy, setEnergy] = useState(
    initial?.energy_wh != null ? whToInput(initial.energy_wh) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { minor, wh, ...next } = validateExpense({ date, category, amount, notes, energy });
    setErrors(next);
    if (Object.keys(next).length > 0 || minor === undefined) return;
    setBusy(true);
    try {
      await onSubmit({
        date,
        category,
        amount_minor: minor,
        notes: notes.trim() === '' ? null : notes.trim(),
        energy_wh: wh ?? null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const i = issuesByField(err.details);
        setErrors({
          date: i.date,
          category: i.category,
          amount: i.amount_minor,
          energy: i.energy_wh,
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
          <p className="hint" id="date-hint-default" data-testid="date-default-hint">
            {DEFAULT_DATE_HINT}
          </p>
        }
      />
      <div className="field">
        <label htmlFor="category">Category</label>
        <select
          id="category"
          name="category"
          value={category}
          aria-invalid={(errors.category ?? si.category) ? true : undefined}
          onChange={(e) => {
            setCategory(e.target.value as ExpenseCategory);
          }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        {(errors.category ?? si.category) ? (
          <p className="error" role="alert">
            {errors.category ?? si.category}
          </p>
        ) : null}
        {category === 'road_tax' ? (
          <p className="hint">
            Road tax (JPJ) is a label only. This app does not contact JPJ and does not know any fees
            or renewal periods.
          </p>
        ) : null}
      </div>
      <TextField
        id="amount"
        label="Amount (MYR)"
        hint="In ringgit, for example 120.50."
        inputMode="decimal"
        autoComplete="off"
        required
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
        }}
        error={errors.amount ?? si.amount_minor}
      />
      {category === 'charging' ? (
        <TextField
          id="energy"
          label="Energy (kWh), optional"
          hint="Energy added, for example 42.5. Lets the app compare cost per kWh."
          inputMode="decimal"
          autoComplete="off"
          value={energy}
          onChange={(e) => {
            setEnergy(e.target.value);
          }}
          error={errors.energy ?? si.energy_wh}
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
