import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { WarrantyTemplate, WarrantyTemplateItem } from '../api/types';
import { validateCoverage } from '../components/CoverageForm';
import { useVehicle, useWarrantyTemplates } from '../data/hooks';
import { saveCoverageBatch } from '../data/mutations';
import { addMonths, isIsoDate } from '../lib/dates';
import { uuid } from '../lib/uuid';

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
  if (templates === undefined || vehicle === undefined) return <p role="status">Loading…</p>;
  const template = templates.items[0];
  if (!template) {
    return (
      <section>
        <h1>Suggested factory warranty terms</h1>
        <p className="muted">
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
    <section aria-labelledby="wtpl-title">
      <h1 id="wtpl-title">Suggested factory warranty terms</h1>
      <p className="notice info" data-testid="template-suggestion-only">
        This is a suggestion. Nothing is created until you press &quot;Create selected
        coverages&quot;. Leaving this page creates nothing.
      </p>
      <h2>{template.name}</h2>
      <p className="small" data-testid="template-source">
        Source: {src.title} ({src.url}). Research entry {src.research_ref}, status {src.status},
        retrieved {src.retrieved}.
      </p>
      <p className="small" data-testid="template-caveat">
        {template.caveat}
      </p>

      <div className="field">
        <label htmlFor="baseline">Baseline start date (required)</label>
        <p id="baseline-hint" className="hint">
          {purchaseDate !== null && baseline === purchaseDate
            ? 'Prefilled from the vehicle purchase date. This is a guess: change it to the date your warranty really starts, as shown in your own documents.'
            : 'The date your warranty starts, as shown in your own documents.'}
        </p>
        <input
          id="baseline"
          name="baseline"
          type="date"
          value={baseline}
          aria-describedby="baseline-hint"
          aria-invalid={baselineError ? true : undefined}
          onChange={(e) => {
            setBaseline(e.target.value);
          }}
        />
        {baselineError ? (
          <p className="error" role="alert">
            {baselineError}
          </p>
        ) : null}
      </div>

      <ul className="list" aria-label="Suggested coverages">
        {template.items.map((it) => {
          if (it.enter_manually === true) {
            return (
              <li key={it.key} className="card" data-testid={`tpl-manual-${it.key}`}>
                <p className="title">{it.name}</p>
                <p className="muted small">
                  Enter manually. The source says this varies by part type, so no dates or km are
                  suggested.
                </p>
                <Link to="/warranty/new" className="button">
                  Add it yourself
                </Link>
              </li>
            );
          }
          const v = row(it);
          const id = `tpl-${it.key}`;
          return (
            <li key={it.key} className="card">
              <label className="check">
                <input
                  type="checkbox"
                  checked={v.selected}
                  onChange={(e) => {
                    set(it.key, { selected: e.target.checked });
                  }}
                />
                {it.name}: {it.months} months / {it.km?.toLocaleString()} km
              </label>
              <div className="field">
                <label htmlFor={`${id}-name`}>Name</label>
                <input
                  id={`${id}-name`}
                  value={v.name}
                  onChange={(e) => {
                    set(it.key, { name: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-start`}>Start date</label>
                <input
                  id={`${id}-start`}
                  type="date"
                  value={v.start_date}
                  onChange={(e) => {
                    set(it.key, { start_date: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-end`}>End date</label>
                <input
                  id={`${id}-end`}
                  type="date"
                  value={v.end_date}
                  onChange={(e) => {
                    set(it.key, { end_date: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-km`}>Km limit</label>
                <input
                  id={`${id}-km`}
                  inputMode="numeric"
                  value={v.km_limit}
                  onChange={(e) => {
                    set(it.key, { km_limit: e.target.value });
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-notes`}>Notes</label>
                <textarea
                  id={`${id}-notes`}
                  rows={2}
                  value={v.notes}
                  onChange={(e) => {
                    set(it.key, { notes: e.target.value });
                  }}
                />
              </div>
              {errors[it.key] ? (
                <p className="error" role="alert">
                  {it.name}: {errors[it.key]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {formError ? (
        <p role="alert" className="error">
          {formError}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={accept}>
          Create selected coverages
        </button>
        <button
          type="button"
          onClick={() => {
            void nav('/warranty');
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
