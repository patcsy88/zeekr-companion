import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FailedNotice } from '../components/ErrorBox';
import { SyncBadge } from '../components/SyncBadge';
import { useExpense } from '../data/hooks';
import { removeExpense } from '../data/mutations';
import { formatDate, formatTimestamp } from '../lib/dates';
import { CATEGORY_LABELS } from '../lib/expenseText';
import { formatKwh } from '../lib/energy';
import { formatMyr } from '../lib/money';
import { isUuid } from '../lib/uuid';
import { discardFailed, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';

export function ExpenseDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <ExpenseDetail id={id} />;
}

function ExpenseDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useExpense(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) {
    return (
      <section>
        <h1>Expense not found</h1>
        <p className="muted">It may have been deleted, or it is not saved on this device.</p>
        <Link to="/expenses">Back to expenses</Link>
      </section>
    );
  }
  const { expense: x, sync, error } = data.view;

  async function confirmDelete() {
    setBusy(true);
    try {
      await removeExpense(id);
      void nav('/expenses', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="exp-detail-title">
      <div className="row">
        <h1 id="exp-detail-title">{CATEGORY_LABELS[x.category]}</h1>
        <SyncBadge sync={sync} />
      </div>
      {sync === 'pending' || sync === 'sending' ? (
        <p className="notice info">
          This change is saved on this device and has not reached the server yet.
        </p>
      ) : null}
      {sync === 'failed' && error ? (
        <>
          <FailedNotice error={error} />
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void retryFailed(id).then(() => syncAll(true));
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                void discardFailed(id);
              }}
            >
              Discard my change
            </button>
          </div>
        </>
      ) : null}
      <dl className="details">
        <dt>Date</dt>
        <dd>
          <time dateTime={x.date}>{formatDate(x.date)}</time>
        </dd>
        <dt>Category</dt>
        <dd>{CATEGORY_LABELS[x.category]}</dd>
        <dt>Amount</dt>
        <dd>{formatMyr(x.amount_minor)}</dd>
        {x.energy_wh != null ? (
          <>
            <dt>Energy</dt>
            <dd>{formatKwh(x.energy_wh)}</dd>
          </>
        ) : null}
        <dt>Notes</dt>
        <dd className="prewrap">{x.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={x.updated_at}>{formatTimestamp(x.updated_at)}</time>
        </dd>
      </dl>

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="del-exp-title"
          aria-describedby="del-exp-desc"
          className="notice bad"
        >
          <h2 id="del-exp-title">Delete this expense?</h2>
          <p id="del-exp-desc">This cannot be undone.</p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              Delete
            </button>
            <button
              type="button"
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <Link to={`/expenses/${id}/edit`} className="button primary">
            Edit
          </Link>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete
          </button>
          <Link to="/expenses">Back</Link>
        </div>
      )}
    </article>
  );
}
