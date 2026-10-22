import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FailedNotice } from '../components/ErrorBox';
import { BasisNote, StatusBadge } from '../components/ReminderParts';
import { SyncBadge } from '../components/SyncBadge';
import { useReminder } from '../data/hooks';
import { removeReminder, saveReminderEdit } from '../data/mutations';
import { formatDate, formatTimestamp } from '../lib/dates';
import { dateText, KIND_CONTEXT, KIND_LABELS, kmText } from '../lib/reminderText';
import { isUuid } from '../lib/uuid';
import { discardFailed, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';

export function ReminderDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <ReminderDetail id={id} />;
}

function ReminderDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useReminder(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) {
    return (
      <section>
        <h1>Reminder not found</h1>
        <p className="muted">It may have been deleted, or it is not saved on this device.</p>
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
      <div className="row">
        <h1 id="rem-detail-title">{r.title}</h1>
        <StatusBadge view={view} basis={basis} today={today} />
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
      {actionError ? (
        <p role="alert" className="error">
          {actionError}
        </p>
      ) : null}
      <dl className="details">
        <dt>Kind</dt>
        <dd>
          {KIND_LABELS[r.kind]}
          {KIND_CONTEXT[r.kind] ? ` · ${KIND_CONTEXT[r.kind] ?? ''}` : ''}
        </dd>
        <dt>Due date</dt>
        <dd>{when ?? '—'}</dd>
        <dt>Due odometer</dt>
        <dd>{km ?? '—'}</dd>
        <dt>Completed</dt>
        <dd>
          {r.completed_on ? (
            <time dateTime={r.completed_on}>{formatDate(r.completed_on)}</time>
          ) : (
            'Not yet'
          )}
        </dd>
        <dt>Notes</dt>
        <dd className="prewrap">{r.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={r.updated_at}>{formatTimestamp(r.updated_at)}</time>
        </dd>
      </dl>
      {r.due_odometer !== null ? <BasisNote basis={basis} /> : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="del-rem-title"
          aria-describedby="del-rem-desc"
          className="notice bad"
        >
          <h2 id="del-rem-title">Delete this reminder?</h2>
          <p id="del-rem-desc">This cannot be undone.</p>
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
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void toggleComplete()}
          >
            {r.completed_on === null ? 'Mark complete' : 'Reopen'}
          </button>
          <Link to={`/reminders/${id}/edit`} className="button">
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
          <Link to="/reminders">Back</Link>
        </div>
      )}
    </article>
  );
}
