import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TyreEvent } from '../api/types';
import { FailedNotice } from '../components/ErrorBox';
import { Skeleton } from '../components/Skeleton';
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
    <section aria-labelledby="rot-rem-title" className="card">
      <h2 id="rot-rem-title">Rotation reminder</h2>
      <div className="field">
        <label htmlFor="rot-interval">Rotate again after (km)</label>
        <p id="rot-interval-hint" className="hint">
          The app does not suggest an interval. The reminder is due at this event&apos;s odometer
          plus the number you type.
        </p>
        <input
          id="rot-interval"
          inputMode="numeric"
          autoComplete="off"
          value={interval}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'rot-interval-hint rot-interval-error' : 'rot-interval-hint'}
          onChange={(e) => {
            setIntervalKm(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id="rot-interval-error" className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="button" onClick={open}>
        Add rotation reminder
      </button>
      <p className="muted small">
        This opens the Add reminder form filled in. Nothing is saved until you save that form.
      </p>
    </section>
  );
}

function TyreEventDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useTyreEvent(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (data === undefined) return <Skeleton />;
  if (data.view === null) {
    return (
      <section>
        <h1>Tyre event not found</h1>
        <p className="muted">It may have been deleted, or it is not saved on this device.</p>
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
      <div className="row">
        <h1 id="tyre-detail-title">{KIND_LABELS[x.kind]}</h1>
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
        <dd className="prewrap">{x.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={x.updated_at}>{formatTimestamp(x.updated_at)}</time>
        </dd>
      </dl>

      {x.kind === 'rotate' ? <RotationReminder event={x} /> : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="del-tyre-title"
          aria-describedby="del-tyre-desc"
          className="notice bad"
        >
          <h2 id="del-tyre-title">Delete this tyre event?</h2>
          <p id="del-tyre-desc">This cannot be undone.</p>
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
          <Link to={`/vehicle/tyres/${id}/edit`} className="button primary">
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
          <Link to="/vehicle/tyres">Back</Link>
        </div>
      )}
    </article>
  );
}
