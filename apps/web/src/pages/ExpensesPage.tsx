import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../api/errors';
import type { ExpenseCategory } from '../api/types';
import { SyncBadge } from '../components/SyncBadge';
import { useConnectivity, useExpenses, useSession } from '../data/hooks';
import { loadMoreExpenses } from '../data/expenses';
import { formatDate, isIsoDate, klToday } from '../lib/dates';
import { expenseTotals, filterExpenses } from '../lib/expenseTotals';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COMPUTED_ON_DEVICE,
  isCategory,
  NOT_INCLUDED,
} from '../lib/expenseText';
import { formatMyr } from '../lib/money';

export function ExpensesPage() {
  const snap = useExpenses();
  const { online } = useConnectivity();
  const session = useSession();
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      filterExpenses(
        (snap?.views ?? []).map((v) => ({ ...v.expense, view: v })),
        { category: category || null, from: from || null, to: to || null },
      ),
    [snap, category, from, to],
  );
  const totals = useMemo(() => expenseTotals(shown), [shown]);

  if (snap === undefined) return <p role="status">Loading…</p>;

  const badRange = isIsoDate(from) && isIsoDate(to) && from > to;
  const active: string[] = [];
  if (category) active.push(`Category: ${CATEGORY_LABELS[category]}`);
  if (from) active.push(`From ${isIsoDate(from) ? formatDate(from) : from}`);
  if (to) active.push(`To ${isIsoDate(to) ? formatDate(to) : to}`);

  function setRange(start: string) {
    setFrom(start);
    setTo(klToday());
  }
  async function more() {
    setLoading(true);
    setError(null);
    try {
      await loadMoreExpenses();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  const empty = snap.views.length === 0;
  return (
    <section aria-labelledby="exp-title">
      <div className="row">
        <h1 id="exp-title">Expenses</h1>
        <Link to="/expenses/new" className="button primary">
          Add expense
        </Link>
      </div>

      {!snap.loaded && empty ? (
        <p className="muted">
          {session.signedIn
            ? online
              ? 'Loading expenses…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your expenses.'}
        </p>
      ) : (
        <>
          <form
            className="card"
            aria-label="Filters"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <div className="field">
              <label htmlFor="f-category">Category</label>
              <select
                id="f-category"
                value={category}
                onChange={(e) => {
                  setCategory(isCategory(e.target.value) ? e.target.value : '');
                }}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input
                id="f-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input
                id="f-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                }}
              />
            </div>
            {badRange ? (
              <p className="error" role="alert">
                &quot;From&quot; is later than &quot;To&quot;, so nothing matches.
              </p>
            ) : null}
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setRange(`${klToday().slice(0, 7)}-01`);
                }}
              >
                This month
              </button>
              <button
                type="button"
                onClick={() => {
                  setRange(`${klToday().slice(0, 4)}-01-01`);
                }}
              >
                This year
              </button>
              <button
                type="button"
                onClick={() => {
                  setCategory('');
                  setFrom('');
                  setTo('');
                }}
              >
                Clear filters
              </button>
            </div>
          </form>
          <p className="muted small" data-testid="active-filters">
            {active.length > 0 ? `Active filters: ${active.join(', ')}` : 'No filters active.'}
          </p>

          <section aria-labelledby="exp-totals-title" className="card" data-testid="totals">
            <h2 id="exp-totals-title">Totals</h2>
            {snap.partial ? (
              <p role="status" className="notice bad" data-testid="partial-warning">
                Partial: {snap.views.length.toLocaleString()}{' '}
                {snap.views.length === 1 ? 'expense' : 'expenses'} loaded. Older expenses are not
                saved on this device, so these totals are not complete.
              </p>
            ) : null}
            <p>
              <strong data-testid="total-amount">{formatMyr(totals.total_minor)}</strong> in{' '}
              <span data-testid="total-count">{totals.count.toLocaleString()}</span>{' '}
              {totals.count === 1 ? 'expense' : 'expenses'}
            </p>
            <p className="muted small">{NOT_INCLUDED}</p>
            <p className="muted small" data-testid="totals-offline-note">
              {COMPUTED_ON_DEVICE}
            </p>
            {totals.count > 0 ? (
              <>
                <h3>By category</h3>
                <ul aria-label="Totals by category" className="plain">
                  {totals.by_category.map((c) => (
                    <li key={c.category}>
                      {CATEGORY_LABELS[c.category]}: {formatMyr(c.total_minor)} ({c.count})
                    </li>
                  ))}
                </ul>
                <h3>By month</h3>
                <ul aria-label="Totals by month" className="plain">
                  {totals.by_month.map((m) => (
                    <li key={m.month}>
                      {m.month}: {formatMyr(m.total_minor)} ({m.count})
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {empty ? (
            <p className="muted">No expenses yet.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No expenses match these filters.</p>
          ) : (
            <ul className="list" aria-label="Expenses, newest first">
              {shown.map(({ view, id, date, category: cat, amount_minor, notes }) => (
                <li key={id} className="item">
                  <Link to={`/expenses/${id}`}>
                    <span className="title">
                      {CATEGORY_LABELS[cat]} · {formatMyr(amount_minor)}
                    </span>
                    <span className="meta">
                      <time dateTime={date}>{formatDate(date)}</time>
                    </span>
                    {notes ? <span className="meta">{notes}</span> : null}
                  </Link>
                  <SyncBadge sync={view.sync} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {snap.nextCursor ? (
        <button
          type="button"
          onClick={() => {
            void more();
          }}
          disabled={loading || !online || !session.signedIn}
        >
          {loading ? 'Loading…' : 'Load older expenses'}
        </button>
      ) : null}
    </section>
  );
}
