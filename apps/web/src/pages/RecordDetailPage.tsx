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
import { Skeleton } from '../components/Skeleton';
import { Details, HEAD, MUTED, NOTICE, PREWRAP, ROW_ACTIONS } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';

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

  if (data === undefined) return <Skeleton />;
  if (data.view === null) {
    return (
      <section>
        <h1>Record not found</h1>
        <p className={MUTED}>It may have been deleted, or it is not saved on this device.</p>
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
      <div className={HEAD}>
        <h1 id="rec-title">{record.description}</h1>
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
          <time dateTime={record.date}>{formatDate(record.date)}</time>
        </dd>
        <dt>Odometer</dt>
        <dd>{record.odometer.toLocaleString()} km</dd>
        <dt>Provider</dt>
        <dd>{record.provider ?? '—'}</dd>
        <dt>Cost</dt>
        <dd>{formatMyr(record.cost_minor)}</dd>
        <dt>Notes</dt>
        <dd className={PREWRAP}>{record.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={record.updated_at}>{formatTimestamp(record.updated_at)}</time>
        </dd>
      </Details>

      <div className={ROW_ACTIONS}>
        <Button variant="outline" size="lg" render={<Link to={`/records/${id}/edit`} />}>
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
        <Link to="/">Back</Link>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this service record?"
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
