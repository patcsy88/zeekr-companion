import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import type { LiveCard } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import { formatKl } from '../lib/liveVehicle';
import { useSentryPush, type PushedSentry } from '../lib/sentryPush';
import { SentryControl } from './SentryControl';

/** What the car reported right after a send. It holds only while the page still shows the
 * reading it was read against; a newer card reading replaces it. */
interface SentrySeen {
  on: boolean;
  at: string;
  basis: string | null;
}

/**
 * The Sentry on/off command (ADR-010), on the Sentry tab. The switch shows the state the car last
 * reported. It reads the same live card as the Vehicle page (the server spaces real reads), asks
 * when the page opens, becomes visible or Refresh is pressed, and follows a send made elsewhere.
 * Text from the server is never shown, only fixed wording.
 */
export function SentryPanel({ onNote }: { onNote: (text: string | null) => void }) {
  return <SentryPanelBody onNote={onNote} />;
}

function SentryPanelBody({ onNote }: { onNote: (text: string | null) => void }) {
  const session = useSession();
  const { online } = useConnectivity();
  const active = session.signedIn && online;
  const [card, setCard] = useState<LiveCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenLocal, setSeenLocal] = useState<SentrySeen | null>(null);
  const [pushed, setPushed] = useState<PushedSentry | null>(null);
  const inflight = useRef(false);
  useSentryPush(active, setPushed);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await request<LiveCard>({ method: 'GET', path: '/live-vehicle' });
      setCard(r.data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void Promise.resolve().then(onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, load]);

  if (!active) return <p className="muted">The Sentry switch needs a connection.</p>;
  if (card === null)
    return <p role="status">{failed ? 'Could not load the car state.' : 'Loading…'}</p>;
  if (card.status === 'off') {
    return (
      <p className="muted" data-testid="live-off">
        Live readings are off, so the Sentry switch is not available.
      </p>
    );
  }

  const local = seenLocal !== null && seenLocal.basis === card.received_at ? seenLocal : null;
  // A state pushed from another page counts only while it is newer than the card's own reading.
  const remote =
    pushed !== null && (card.received_at === null || pushed.at > card.received_at) ? pushed : null;
  const seen = local && remote ? (remote.at > local.at ? remote : local) : (remote ?? local);

  return (
    <div data-testid="sentry-panel">
      {card.status === 'paused' ? (
        <p role="alert" className="notice bad" data-testid="live-paused">
          Live readings are paused after repeated failures. They stay paused until the API is
          restarted.
        </p>
      ) : null}
      {card.status === 'unavailable' ? (
        <p role="alert" className="notice bad" data-testid="live-unavailable">
          Could not get a new reading. Showing the last one stored.
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="notice bad">
          Could not refresh. Showing the last reading received.
        </p>
      ) : null}
      {seen ? (
        <p role="status" className="notice info" data-testid="sentry-seen">
          Sentry: {seen.on ? 'on' : 'off'}, read from the car at {formatKl(seen.at)}.
        </p>
      ) : card.observed_at !== null ? (
        <p className="muted small" data-testid="live-asof">
          As of {formatKl(card.observed_at)}
          {card.received_at ? `, received ${formatKl(card.received_at)}` : ''}.
        </p>
      ) : null}
      <SentryControl
        current={seen ? seen.on : card.readings.indicators.sentry_active}
        onResult={onNote}
        onSeen={(on) => {
          setSeenLocal({ on, at: new Date().toISOString(), basis: card.received_at });
        }}
      />
      <p className="muted small">Sentry may use the car&apos;s 12 V battery while it is on.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onNote(null);
          setBusy(true);
          void load();
        }}
      >
        Refresh
      </button>
    </div>
  );
}
