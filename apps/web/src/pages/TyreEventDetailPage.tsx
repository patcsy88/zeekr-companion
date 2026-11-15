import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TyreEvent } from '../api/types';
import { FailedNotice } from '../components/ErrorBox';
import { Skeleton } from '../components/Skeleton';
import { Details, HEAD, MUTED, NOTICE, PREWRAP, ROW_ACTIONS, SMALL } from '../components/ListParts';
import { TextField } from '../components/Field';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Card } from '../components/ui/card';
import { SyncBadge } from '../components/SyncBadge';
import { useTyreEvent } from '../data/hooks';
import { removeTyreEvent } from '../data/mutations';
import { formatDate, formatTimestamp } from '../lib/dates';
import { formatMyr } from '../lib/money';
import { KIND_LABELS, ROTATION_TITLE, wheelsText } from '../lib/tyreText';
import { isUuid } from '../lib/uuid';
import { discardFailed, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';

export function TyreEventDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <TyreEventDetail id={id} />;
}

/** The location state NewReminderPage reads for a rotation reminder (AC-83). */
export interface TyreReminderState {
  tyrePrefill: { title: string; due_odometer: number };
}

/** AC-83: the owner types the interval; nothing is suggested and nothing is saved here. */
function RotationReminder({ event }: { event: TyreEvent }) {
  const nav = useNavigate();
  const [interval, setIntervalKm] = useState('');
  const [error, setError] = useState<string | null>(null);

  function open() {
    const n = interval.trim();
    if (!/^\d{1,8}$/.test(n) || Number(n) < 1) {
      setError('Enter the interval in whole kilometres, for example the one your shop advised.');
      return;
    }
    const due = event.odometer + Number(n);
    if (due > 10_000_000) {
      setError('That makes the due odometer more than 10,000,000 km.');
      return;
    }
    const state: TyreReminderState = { tyrePrefill: { title: ROTATION_TITLE, due_odometer: due } };
    void nav('/reminders/new', { state });
  }

  return (
    <Card
      render={<section />}
      aria-labelledby="rot-rem-title"
      className="my-4 flex flex-col gap-4 p-4"
    >
      <h2 id="rot-rem-title" className="m-0">
        Rotation reminder
      </h2>
      <TextField
        id="rot-interval"
        label="Rotate again after (km)"
        hint="The app does not suggest an interval. The reminder is due at this event's odometer plus the number you type."
        inputMode="numeric"
        autoComplete="off"
        value={interval}
        error={error}
        onChange={(e) => {
          setIntervalKm(e.target.value);
          setError(null);
        }}
      />
      <Button variant="outline" size="lg" className="self-start" onClick={open}>
        Add rotation reminder
      </Button>
      <p className={SMALL}>
        This opens the Add reminder form filled in. Nothing is saved until you save that form.
      </p>
    </Card>
  );
}

function TyreEventDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useTyreEvent(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <Skeleton />;
  if (data.view === null) {
    return (
      <section>
        <h1>Tyre event not found</h1>
        <p className={MUTED}>It may have been deleted, or it is not saved on this device.</p>
        <Link to="/vehicle/tyres">Back to tyres</Link>
      </section>
    );
  }
  const { event: x, sync, error } = data.view;

  async function confirmDelete() {
    setBusy(true);
    try {
      await removeTyreEvent(id);
      void nav('/vehicle/tyres', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="tyre-detail-title">
      <div className={HEAD}>
        <h1 id="tyre-detail-title">{KIND_LABELS[x.kind]}</h1>
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
        <dt>Wheels</dt>
        <dd>{wheelsText(x.wheels)}</dd>
        <dt>Odometer</dt>
        <dd>{x.odometer.toLocaleString()} km</dd>
        {x.kind === 'replace' ? (
          <>
            <dt>Brand</dt>
            <dd>{x.brand ?? '—'}</dd>
            <dt>Model</dt>
            <dd>{x.model ?? '—'}</dd>
            <dt>Size</dt>
            <dd>{x.size ?? '—'}</dd>
          </>
        ) : null}
        <dt>Cost</dt>
        <dd>{x.cost_minor !== null ? formatMyr(x.cost_minor) : '—'}</dd>
        <dt>Shop</dt>
        <dd>{x.shop ?? '—'}</dd>
        <dt>Notes</dt>
        <dd className={PREWRAP}>{x.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={x.updated_at}>{formatTimestamp(x.updated_at)}</time>
        </dd>
      </Details>

      {x.kind === 'rotate' ? <RotationReminder event={x} /> : null}

      <div className={ROW_ACTIONS}>
        <Button size="lg" render={<Link to={`/vehicle/tyres/${id}/edit`} />}>
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
        <Link to="/vehicle/tyres">Back</Link>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this tyre event?"
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
