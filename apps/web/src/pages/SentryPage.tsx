import { useCallback, useEffect, useState } from 'react';
import { request } from '../api/client';
import type { AdvisoryProposal, AdvisoryProposalList } from '../api/types';
import { SentryPanel } from '../components/SentryPanel';
import { useConnectivity, useSession } from '../data/hooks';

export const GEOFENCE_CONDITION = 'sentry_off_outside_geofence';

export function SentryPage() {
  const session = useSession();
  const { online } = useConnectivity();
  const [items, setItems] = useState<AdvisoryProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteEl = note ? (
    <p role="status" className="notice info" data-testid="sentry-result">
      {note}
    </p>
  ) : null;
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => {
    setReloads((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!session.signedIn || !online) return;
    let live = true;
    void (async () => {
      try {
        const r = await request<AdvisoryProposalList>({
          method: 'GET',
          path: '/advisory/proposals?status=proposed',
        });
        if (!live) return;
        setItems(r.data.items.filter((p) => p.condition === GEOFENCE_CONDITION));
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load.');
      }
    })();
    return () => {
      live = false;
    };
  }, [session.signedIn, online, reloads]);

  async function dismiss(p: AdvisoryProposal) {
    setBusy(true);
    try {
      await request({
        method: 'PATCH',
        path: `/advisory/proposals/${p.id}`,
        body: { status: 'dismissed' },
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss.');
    } finally {
      setBusy(false);
    }
  }

  if (!session.signedIn || !online) {
    return (
      <section aria-labelledby="sentry-title">
        <h1 id="sentry-title">Sentry</h1>
        <p className="muted">This page needs a sign-in and a connection to the server.</p>
        {noteEl}
      </section>
    );
  }

  return (
    <section aria-labelledby="sentry-title">
      <h1 id="sentry-title">Sentry</h1>
      <p className="muted small">
        A notice appears here when the car is parked asleep outside your home area with Sentry off.
        The notice itself sends nothing to the car. The switch below sends a command only when you
        confirm it.
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {items === null ? (
        <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted" data-testid="sentry-none">
          No open geofence alert.
        </p>
      ) : (
        <ul className="list" aria-label="Geofence alerts">
          {items.map((p) => (
            <li key={p.id} data-testid="geofence-alert" className="geofence-alert">
              <h2>The car is parked outside your home area with Sentry off.</h2>
              <p>
                Last reported {String(p.inputs.reading_age_minutes ?? '?')} minutes before this
                check. Opened {new Date(p.created_at).toLocaleString()}.
              </p>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => void dismiss(p)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2 className="small">Sentry command</h2>
      <p className="muted small">
        This is the one thing the app can send to the car: Sentry on or off. It asks first and sends
        once.
      </p>
      <SentryPanel onNote={setNote} />
      {noteEl}
    </section>
  );
}
