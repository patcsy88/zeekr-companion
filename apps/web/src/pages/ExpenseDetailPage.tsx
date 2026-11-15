import { useState } from 'react';
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
import { Skeleton } from '../components/Skeleton';
import { Details, HEAD, MUTED, NOTICE, PREWRAP, ROW_ACTIONS } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';

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

  if (data === undefined) return <Skeleton />;
  if (data.view === null) {
    return (
      <section>
        <h1>Expense not found</h1>
        <p className={MUTED}>It may have been deleted, or it is not saved on this device.</p>
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
      <div className={HEAD}>
        <h1 id="exp-detail-title">{CATEGORY_LABELS[x.category]}</h1>
        <SyncBadge sync={sync} />
      </div>
      {sync === 'pending' || sync === 'sending' ? (
        <p className={NOTICE.info}>
          This change is saved on this device and has not reached the server yet.
        </p>
      ) : null}
      {sync === 'failed' && error ? (
        <>
          <FailedNotice error={error} />
          <div className={ROW_ACTIONS}>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                void retryFailed(id).then(() => syncAll(true));
              }}
            >
              Retry
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                void discardFailed(id);
              }}
            >
              Discard my change
            </Button>
          </div>
        </>
      ) : null}
      <Details>
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
        <dd className={PREWRAP}>{x.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={x.updated_at}>{formatTimestamp(x.updated_at)}</time>
        </dd>
      </Details>

      <div className={ROW_ACTIONS}>
        <Button size="lg" render={<Link to={`/expenses/${id}/edit`} />}>
          Edit
        </Button>
        <Button
          variant="destructive"
          size="lg"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete
        </Button>
        <Link to="/expenses">Back</Link>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this expense?"
        description="This cannot be undone."
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setConfirming(false);
        }}
      />
    </article>
  );
}
