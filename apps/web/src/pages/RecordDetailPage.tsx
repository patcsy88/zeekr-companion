import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FailedNotice } from '../components/ErrorBox';
import { SyncBadge } from '../components/SyncBadge';
import { useRecord, useSession } from '../data/hooks';
import { removeRecord } from '../data/mutations';
import { refreshRecord } from '../data/repository';
import { formatDate, formatTimestamp } from '../lib/dates';
import { isUuid } from '../lib/uuid';
import { formatMyr } from '../lib/money';
import { discardFailed, listQueue, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';

/** The route id must be a UUID before anything is read or fetched: nothing else reaches the API. */
export function RecordDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <RecordDetail id={id} />;
}

function RecordDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useRecord(id);
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triedFetch = useRef(false);
  // Set as soon as the user confirms a delete. See the effect below.
  const deleting = useRef(false);

  // A record that is not in the cache (for example a deep link) is fetched once if possible.
  // Never for a record this device is deleting: once the delete is queued the record is hidden
  // (view === null), and fetching it then would ask the server for a record that is about to go,
  // and the late answer could put it back in the list (bug D1).
  useEffect(() => {
    if (!data || data.view !== null || !session.signedIn || triedFetch.current) return;
    if (deleting.current) return;
    triedFetch.current = true;
    let live = true;
    void listQueue().then((q) => {
      if (!live) return;
      if (q.some((e) => e.record_id === id && e.kind === 'delete-record')) return;
      void refreshRecord(id).catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [data, id, session.signedIn]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) {
    return (
      <section>
        <h1>Record not found</h1>
        <p className="muted">It may have been deleted, or it is not saved on this device.</p>
        <Link to="/">Back to service history</Link>
      </section>
    );
  }
  const { record, sync, error } = data.view;

  async function confirmDelete() {
    deleting.current = true;
    setBusy(true);
    try {
      await removeRecord(id);
      void nav('/', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="rec-title">
      <div className="row">
        <h1 id="rec-title">{record.description}</h1>
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
          <time dateTime={record.date}>{formatDate(record.date)}</time>
        </dd>
        <dt>Odometer</dt>
        <dd>{record.odometer.toLocaleString()} km</dd>
        <dt>Provider</dt>
        <dd>{record.provider ?? '—'}</dd>
        <dt>Cost</dt>
        <dd>{formatMyr(record.cost_minor)}</dd>
        <dt>Notes</dt>
        <dd className="prewrap">{record.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={record.updated_at}>{formatTimestamp(record.updated_at)}</time>
        </dd>
      </dl>

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="del-title"
          aria-describedby="del-desc"
          className="notice bad"
        >
          <h2 id="del-title">Delete this service record?</h2>
          <p id="del-desc">This cannot be undone.</p>
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
          <Link to={`/records/${id}/edit`} className="button">
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
          <Link to="/">Back</Link>
        </div>
      )}
    </article>
  );
}
