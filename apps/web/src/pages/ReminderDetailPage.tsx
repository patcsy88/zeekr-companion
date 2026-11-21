import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FailedNotice } from '../components/ErrorBox';
import { BasisNote, StatusBadge } from '../components/ReminderParts';
import { SyncBadge } from '../components/SyncBadge';
import { useConnectivity, useReminder } from '../data/hooks';
import { removeReminder, saveReminderEdit } from '../data/mutations';
import { formatDate, formatTimestamp } from '../lib/dates';
import { formatMyr } from '../lib/money';
import { COVER_LABELS, dateText, KIND_CONTEXT, KIND_LABELS, kmText } from '../lib/reminderText';
import { isUuid } from '../lib/uuid';
import { discardFailed, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';
import { Skeleton } from '../components/Skeleton';
import { Details, HEAD, MUTED, NOTICE, PREWRAP, ROW_ACTIONS } from '../components/ListParts';
import { ERROR, HINT } from '../components/Field';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function ReminderDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <ReminderDetail id={id} />;
}

function ReminderDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useReminder(id);
  const { online } = useConnectivity();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (data === undefined) return <Skeleton />;
  if (data.view === null) {
    return (
      <section>
        <h1>Reminder not found</h1>
        <p className={MUTED}>It may have been deleted, or it is not saved on this device.</p>
        <Link to="/reminders">Back to reminders</Link>
      </section>
    );
  }
  const { view, basis, today } = data;
  const { reminder: r, sync, error } = view;
  const when = dateText(r, today);
  const km = kmText(r, basis?.km ?? null);

  async function toggleComplete() {
    setBusy(true);
    setActionError(null);
    try {
      // `today` is the Malaysian date, which the server accepts as "not in the future".
      await saveReminderEdit(id, { completed_on: r.completed_on === null ? today : null });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await removeReminder(id);
      void nav('/reminders', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="rem-detail-title">
      <div className={HEAD}>
        <h1 id="rem-detail-title">{r.title}</h1>
        <StatusBadge view={view} basis={basis} today={today} />
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
      {actionError ? (
        <p role="alert" className={ERROR}>
          {actionError}
        </p>
      ) : null}
      <Details>
        <dt>Kind</dt>
        <dd>
          {KIND_LABELS[r.kind]}
          {KIND_CONTEXT[r.kind] ? ` · ${KIND_CONTEXT[r.kind] ?? ''}` : ''}
        </dd>
        <dt>Due date</dt>
        <dd>{when ?? '—'}</dd>
        <dt>Due odometer</dt>
        <dd>{km ?? '—'}</dd>
        {r.kind === 'insurance_renewal' ? (
          <>
            <dt>Insurer</dt>
            <dd>{r.insurer ?? '—'}</dd>
            <dt>Cover type</dt>
            <dd>{r.cover_type ? COVER_LABELS[r.cover_type] : '—'}</dd>
            <dt>Premium</dt>
            <dd>{r.premium_minor !== null ? formatMyr(r.premium_minor) : '—'}</dd>
            <dt>Insurer phone</dt>
            <dd>
              {r.insurer_phone ? <a href={`tel:${r.insurer_phone}`}>{r.insurer_phone}</a> : '—'}
            </dd>
          </>
        ) : null}
        {r.kind === 'road_tax_renewal' ? (
          <>
            <dt>Amount</dt>
            <dd>{r.amount_minor !== null ? formatMyr(r.amount_minor) : '—'}</dd>
          </>
        ) : null}
        <dt>Completed</dt>
        <dd>
          {r.completed_on ? (
            <time dateTime={r.completed_on}>{formatDate(r.completed_on)}</time>
          ) : (
            'Not yet'
          )}
        </dd>
        <dt>Notes</dt>
        <dd className={PREWRAP}>{r.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={r.updated_at}>{formatTimestamp(r.updated_at)}</time>
        </dd>
      </Details>
      {r.due_odometer !== null ? <BasisNote basis={basis} /> : null}

      <div className={ROW_ACTIONS}>
        {r.kind === 'service' && r.completed_on === null ? (
          online ? (
            <Button size="lg" render={<Link to={`/reminders/${id}/complete`} />}>
              Complete service
            </Button>
          ) : (
            <>
              <Button size="lg" disabled aria-describedby="cs-offline">
                Complete service
              </Button>
              <p className={HINT} id="cs-offline">
                Completing a service needs a connection.
              </p>
            </>
          )
        ) : (
          <Button size="lg" disabled={busy} onClick={() => void toggleComplete()}>
            {r.completed_on === null ? 'Mark complete' : 'Reopen'}
          </Button>
        )}
        <Button variant="outline" size="lg" render={<Link to={`/reminders/${id}/edit`} />}>
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
        <Link to="/reminders">Back</Link>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this reminder?"
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
