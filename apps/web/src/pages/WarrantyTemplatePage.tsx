import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WarrantyTemplate, WarrantyTemplateItem } from '../api/types';
import { validateCoverage } from '../components/CoverageForm';
import { useVehicle, useWarrantyTemplates } from '../data/hooks';
import { saveCoverageBatch } from '../data/mutations';
import { addMonths, isIsoDate } from '../lib/dates';
import { uuid } from '../lib/uuid';
import { Skeleton } from '../components/Skeleton';
import { ACTIONS, ERROR, FORM, TextArea, TextField } from '../components/Field';
import { LIST, MUTED, NOTICE, SMALL } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';

interface RowEdit {
  selected?: boolean;
  name?: string;
  start_date?: string;
  end_date?: string;
  km_limit?: string;
  notes?: string;
}

export function WarrantyTemplatePage() {
  const templates = useWarrantyTemplates();
  const vehicle = useVehicle();
  if (templates === undefined || vehicle === undefined) return <Skeleton />;
  const template = templates.items[0];
  if (!template) {
    return (
      <section>
        <h1>Suggested factory warranty terms</h1>
        <p className={MUTED}>
          {templates.loaded
            ? 'No suggested terms are available.'
            : 'The suggested terms have not been loaded on this device yet. They need one online visit: open the app while connected, then come back here.'}
        </p>
        <Link to="/warranty">Back to warranty</Link>
      </section>
    );
  }
  return (
    <TemplateReview
      template={template}
      purchaseDate={vehicle.view?.vehicle.purchase_date ?? null}
    />
  );
}

function TemplateReview({
  template,
  purchaseDate,
}: {
  template: WarrantyTemplate;
  purchaseDate: string | null;
}) {
  const nav = useNavigate();
  const [baseline, setBaseline] = useState(purchaseDate ?? '');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baselineOk = isIsoDate(baseline);
  function row(it: WarrantyTemplateItem) {
    const e = edits[it.key] ?? {};
    return {
      selected: e.selected ?? false,
      name: e.name ?? it.name,
      start_date: e.start_date ?? baseline,
      end_date:
        e.end_date ?? (baselineOk && it.months !== null ? addMonths(baseline, it.months) : ''),
      km_limit: e.km_limit ?? (it.km !== null ? String(it.km) : ''),
      notes: e.notes ?? '',
    };
  }
  function set(key: string, patch: RowEdit) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  const selectable = template.items.filter((i) => i.enter_manually !== true);

  function accept() {
    setFormError(null);
    if (!baselineOk) {
      setBaselineError('Enter the baseline start date before accepting.');
      return;
    }
    setBaselineError(null);
    const chosen = selectable.filter((i) => row(i).selected);
    if (chosen.length === 0) {
      setFormError('Select at least one item, or cancel.');
      return;
    }
    const nextErrors: Record<string, string> = {};
    const items = chosen.map((it) => {
      const v = row(it);
      const problems = Object.values(validateCoverage({ ...v, source_note: '' }));
      if (problems.length > 0) nextErrors[it.key] = problems.join(' ');
      return { it, v };
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    void saveCoverageBatch(
      items.map(({ it, v }) => ({
        id: uuid(),
        name: v.name.trim(),
        provider_type: 'factory' as const,
        start_date: v.start_date,
        end_date: v.end_date === '' ? null : v.end_date,
        km_limit: v.km_limit.trim() === '' ? null : Number(v.km_limit),
        notes: v.notes.trim() === '' ? null : v.notes.trim(),
        source_kind: 'template' as const,
        verification_status: 'proposed' as const,
        source_note: `${template.source.title}, research ${it.research_ref}`,
        template_ref: `${template.id}:${it.key}`,
      })),
    )
      .then(() => {
        void nav('/warranty');
      })
      .catch((e: unknown) => {
        setFormError(e instanceof Error ? e.message : 'Could not save.');
        setBusy(false);
      });
  }

  const src = template.source;
  return (
    <section aria-labelledby="wtpl-title" className={FORM}>
      <h1 id="wtpl-title" className="m-0">
        Suggested factory warranty terms
      </h1>
      <p className={NOTICE.info} data-testid="template-suggestion-only">
        This is a suggestion. Nothing is created until you press &quot;Create selected
        coverages&quot;. Leaving this page creates nothing.
      </p>
      <h2 className="m-0">{template.name}</h2>
      <p className={`m-0 ${SMALL}`} data-testid="template-source">
        Source: {src.title} ({src.url}). Research entry {src.research_ref}, status {src.status},
        retrieved {src.retrieved}.
      </p>
      <p className={`m-0 ${SMALL}`} data-testid="template-caveat">
        {template.caveat}
      </p>

      <TextField
        id="baseline"
        label="Baseline start date (required)"
        hint={
          purchaseDate !== null && baseline === purchaseDate
            ? 'Prefilled from the vehicle purchase date. This is a guess: change it to the date your warranty really starts, as shown in your own documents.'
            : 'The date your warranty starts, as shown in your own documents.'
        }
        type="date"
        value={baseline}
        error={baselineError}
        onChange={(e) => {
          setBaseline(e.target.value);
        }}
      />

      <ul className={LIST} aria-label="Suggested coverages">
        {template.items.map((it) => {
          if (it.enter_manually === true) {
            return (
              <Card
                render={<li />}
                key={it.key}
                className="flex flex-col gap-4 p-4"
                data-testid={`tpl-manual-${it.key}`}
              >
                <p className="m-0 font-semibold">{it.name}</p>
                <p className={`m-0 ${SMALL}`}>
                  Enter manually. The source says this varies by part type, so no dates or km are
                  suggested.
                </p>
                <Button
                  variant="outline"
                  size="lg"
                  className="self-start"
                  render={<Link to="/warranty/new" />}
                >
                  Add it yourself
                </Button>
              </Card>
            );
          }
          const v = row(it);
          const id = `tpl-${it.key}`;
          return (
            <Card render={<li />} key={it.key} className="flex flex-col gap-4 p-4">
              <label className="m-0 flex min-h-11 items-center gap-3 font-semibold text-foreground">
                <Checkbox
                  checked={v.selected}
                  onCheckedChange={(checked) => {
                    set(it.key, { selected: checked });
                  }}
                />
                {it.name}: {it.months} months / {it.km?.toLocaleString()} km
              </label>
              <TextField
                id={`${id}-name`}
                label="Name"
                value={v.name}
                onChange={(e) => {
                  set(it.key, { name: e.target.value });
                }}
              />
              <TextField
                id={`${id}-start`}
                label="Start date"
                type="date"
                value={v.start_date}
                onChange={(e) => {
                  set(it.key, { start_date: e.target.value });
                }}
              />
              <TextField
                id={`${id}-end`}
                label="End date"
                type="date"
                value={v.end_date}
                onChange={(e) => {
                  set(it.key, { end_date: e.target.value });
                }}
              />
              <TextField
                id={`${id}-km`}
                label="Km limit"
                inputMode="numeric"
                value={v.km_limit}
                onChange={(e) => {
                  set(it.key, { km_limit: e.target.value });
                }}
              />
              <TextArea
                id={`${id}-notes`}
                label="Notes"
                rows={2}
                value={v.notes}
                onChange={(e) => {
                  set(it.key, { notes: e.target.value });
                }}
              />
              {errors[it.key] ? (
                <p className={ERROR} role="alert">
                  {it.name}: {errors[it.key]}
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
          Create selected coverages
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            void nav('/warranty');
          }}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
