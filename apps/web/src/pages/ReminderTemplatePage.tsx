import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ReminderKind, ReminderTemplate, TemplateCheckpoint } from '../api/types';
import { validateReminder } from '../components/ReminderForm';
import { useReminders, useTemplates, useVehicle } from '../data/hooks';
import { saveReminderBatch } from '../data/mutations';
import { addMonths, isIsoDate } from '../lib/dates';
import { KIND_LABELS, KINDS } from '../lib/reminderText';
import { uuid } from '../lib/uuid';
import { Skeleton } from '../components/Skeleton';
import { ACTIONS, ERROR, FORM, SelectField, TextArea, TextField } from '../components/Field';
import { LIST, MUTED, NOTICE, SMALL } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';

interface RowEdit {
  selected?: boolean;
  kind?: ReminderKind;
  title?: string;
  due_date?: string;
  due_odometer?: string;
  notes?: string;
}

const defaultTitle = (c: TemplateCheckpoint) => `Service ${c.number} (${c.km.toLocaleString()} km)`;
const defaultNotes = (c: TemplateCheckpoint) =>
  c.work_items_stated
    ? `Work items listed by the source: ${c.work_items.join('; ')}.`
    : 'Work items are not stated by the source for this checkpoint.';

export function ReminderTemplatePage() {
  const templates = useTemplates();
  const vehicle = useVehicle();
  const reminders = useReminders();
  if (templates === undefined || vehicle === undefined || reminders === undefined)
    return <Skeleton />;
  const template = templates.items[0];
  if (!template) {
    return (
      <section>
        <h1>Suggested service schedule</h1>
        <p className={MUTED}>
          {templates.loaded
            ? 'No suggested schedule is available.'
            : 'The suggested schedule has not been loaded on this device yet. It needs one online visit: open the app while connected, then come back here.'}
        </p>
        <Link to="/reminders">Back to reminders</Link>
      </section>
    );
  }
  return (
    <TemplateReview
      template={template}
      purchaseDate={vehicle.view?.vehicle.purchase_date ?? null}
      currentKm={reminders.basis?.km ?? null}
    />
  );
}

function TemplateReview({
  template,
  purchaseDate,
  currentKm,
}: {
  template: ReminderTemplate;
  purchaseDate: string | null;
  currentKm: number | null;
}) {
  const nav = useNavigate();
  const [baseline, setBaseline] = useState(purchaseDate ?? '');
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only the next checkpoint (first one above the current odometer, else the first) starts selected.
  const nextNumber = useMemo(
    () =>
      template.checkpoints.find((c) => currentKm === null || c.km > currentKm)?.number ??
      template.checkpoints[0]?.number,
    [template, currentKm],
  );

  const baselineOk = isIsoDate(baseline);
  function row(c: TemplateCheckpoint) {
    const e = edits[c.number] ?? {};
    return {
      selected: e.selected ?? c.number === nextNumber,
      kind: e.kind ?? template.kind,
      title: e.title ?? defaultTitle(c),
      due_date: e.due_date ?? (baselineOk ? addMonths(baseline, c.months) : ''),
      due_odometer: e.due_odometer ?? String(c.km),
      notes: e.notes ?? defaultNotes(c),
    };
  }
  function set(n: number, patch: RowEdit) {
    setEdits((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }));
  }

  function accept() {
    setFormError(null);
    if (!baselineOk) {
      setBaselineError('Enter the baseline date before accepting.');
      return;
    }
    setBaselineError(null);
    const chosen = template.checkpoints.filter((c) => row(c).selected);
    if (chosen.length === 0) {
      setFormError('Select at least one reminder, or cancel.');
      return;
    }
    const nextErrors: Record<number, string> = {};
    const items = chosen.map((c) => {
      const v = row(c);
      const problems = Object.values(validateReminder(v));
      if (problems.length > 0) nextErrors[c.number] = problems.join(' ');
      return { c, v };
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    void saveReminderBatch(
      items.map(({ c, v }) => ({
        id: uuid(),
        kind: v.kind,
        title: v.title.trim(),
        due_date: v.due_date === '' ? null : v.due_date,
        due_odometer: v.due_odometer.trim() === '' ? null : Number(v.due_odometer),
        notes: v.notes.trim() === '' ? null : v.notes.trim(),
        template_ref: `${template.id}:${template.version}:${c.number}`,
      })),
    )
      .then(() => {
        void nav('/reminders');
      })
      .catch((e: unknown) => {
        setFormError(e instanceof Error ? e.message : 'Could not save.');
        setBusy(false);
      });
  }

  const src = template.source;
  return (
    <section aria-labelledby="tpl-title" className={FORM}>
      <h1 id="tpl-title" className="m-0">
        Suggested service schedule
      </h1>
      <p className={NOTICE.info} data-testid="template-suggestion-only">
        This is a suggestion. Nothing is created until you press &quot;Create selected
        reminders&quot;. Leaving this page creates nothing.
      </p>
      <h2 className="m-0">{template.name}</h2>
      <p className="m-0">
        Every {template.interval.km.toLocaleString()} km or {template.interval.months} months,{' '}
        {template.interval.rule}.
      </p>
      <p className={`m-0 ${SMALL}`} data-testid="template-source">
        Source: {src.title} ({src.url}). Research entry {src.research_ref}, status {src.status},
        retrieved {src.retrieved}.
      </p>
      <p className={`m-0 ${SMALL}`} data-testid="template-caveat">
        {template.caveat}
      </p>

      <TextField
        id="baseline"
        label="Baseline date (required)"
        hint={
          purchaseDate !== null && baseline === purchaseDate
            ? 'Prefilled from the vehicle purchase date. This is a guess: change it to the date your service interval really starts from, for example your last service.'
            : 'The date your service interval starts from, for example your last service.'
        }
        type="date"
        value={baseline}
        error={baselineError}
        onChange={(e) => {
          setBaseline(e.target.value);
        }}
      />

      <ul className={LIST} aria-label="Suggested reminders">
        {template.checkpoints.map((c) => {
          const v = row(c);
          const id = `cp${c.number}`;
          return (
            <Card render={<li />} key={c.number} className="flex flex-col gap-4 p-4">
              <label className="m-0 flex min-h-11 items-center gap-3 font-semibold text-foreground">
                <Checkbox
                  checked={v.selected}
                  onCheckedChange={(checked) => {
                    set(c.number, { selected: checked });
                  }}
                />
                Checkpoint {c.number}: {c.km.toLocaleString()} km / {c.months} months
              </label>
              <p className={`m-0 ${SMALL}`}>
                {c.work_items_stated
                  ? `Work items: ${c.work_items.join('; ')}.`
                  : 'Work items: not stated by the source.'}
              </p>
              <SelectField
                id={`${id}-kind`}
                label="Kind"
                value={v.kind}
                onChange={(e) => {
                  set(c.number, { kind: e.target.value as ReminderKind });
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </SelectField>
              <TextField
                id={`${id}-title`}
                label="Title"
                value={v.title}
                onChange={(e) => {
                  set(c.number, { title: e.target.value });
                }}
              />
              <TextField
                id={`${id}-date`}
                label="Due date"
                type="date"
                value={v.due_date}
                onChange={(e) => {
                  set(c.number, { due_date: e.target.value });
                }}
              />
              <TextField
                id={`${id}-km`}
                label="Due odometer (km)"
                inputMode="numeric"
                value={v.due_odometer}
                onChange={(e) => {
                  set(c.number, { due_odometer: e.target.value });
                }}
              />
              <TextArea
                id={`${id}-notes`}
                label="Notes"
                rows={2}
                value={v.notes}
                onChange={(e) => {
                  set(c.number, { notes: e.target.value });
                }}
              />
              {errors[c.number] ? (
                <p className={ERROR} role="alert">
                  Checkpoint {c.number}: {errors[c.number]}
                </p>
              ) : null}
            </Card>
          );
        })}
      </ul>

      {formError ? (
        <p role="alert" className={ERROR}>
          {formError}
        </p>
      ) : null}
      <div className={ACTIONS}>
        <Button size="lg" disabled={busy} onClick={accept}>
          Create selected reminders
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            void nav('/reminders');
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
