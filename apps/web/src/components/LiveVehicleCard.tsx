import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/client';
import type { LiveCard } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import { days, formatKl, km, kpa, percent, yesNo } from '../lib/liveVehicle';
import { usePullToRefresh } from '../lib/pullToRefresh';

/**
 * Read-only live readings from the car (ADR-009). Online only: nothing here is stored on the
 * device or cached. The page asks on a timer while it is visible; the server spaces real reads.
 * Text from the server is never shown, only fixed wording.
 */
export function LiveVehicleCard() {
  const session = useSession();
  const { online } = useConnectivity();
  const [card, setCard] = useState<LiveCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inflight = useRef(false);
  const active = session.signedIn && online;

  const load = useCallback(async (manual: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await request<LiveCard>({ method: 'GET', path: '/live-vehicle' });
      setCard(r.data);
      setFailed(false);
      setNote(
        manual && r.data.status === 'ok' && r.data.served_from === 'cache'
          ? 'No newer reading yet.'
          : null,
      );
    } catch {
      setFailed(true);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const visible = () => document.visibilityState === 'visible';
    const onVisible = () => {
      if (visible()) void load(false);
    };
    void Promise.resolve().then(onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, load]);

  const minutes = card?.interval_minutes ?? null;
  const status = card?.status ?? null;
  useEffect(() => {
    if (!active || minutes === null || status === 'off' || status === 'paused') return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, minutes * 60_000);
    return () => {
      clearInterval(id);
    };
  }, [active, minutes, status, load]);

  const refresh = () => {
    if (inflight.current) return;
    setBusy(true);
    void load(true);
  };

  usePullToRefresh(() => {
    if (active) refresh();
  });

  return (
    <section aria-labelledby="live-title" className="live-card" data-testid="live-card">
      <div className="row">
        <h2 id="live-title">Live from the car</h2>
        {active && status !== 'off' && status !== 'paused' ? (
          <button type="button" disabled={busy} onClick={refresh}>
            Refresh
          </button>
        ) : null}
      </div>
      <p className="muted small">Read-only. Nothing is sent to the car.</p>
      {!session.signedIn || !online ? (
        <p className="muted" data-testid="live-offline">
          Needs a connection.
        </p>
      ) : card === null ? (
        <p role="status">{failed ? 'Could not load live readings.' : 'Loading…'}</p>
      ) : (
        <CardBody card={card} failed={failed} note={note} />
      )}
    </section>
  );
}

function CardBody({
  card,
  failed,
  note,
}: {
  card: LiveCard;
  failed: boolean;
  note: string | null;
}) {
  if (card.status === 'off') {
    return (
      <p className="muted" data-testid="live-off">
        Live readings are off.
      </p>
    );
  }
  const r = card.readings;
  const t = r.tyres_kpa;
  return (
    <>
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
      {note ? (
        <p role="status" className="notice info" data-testid="live-note">
          {note}
        </p>
      ) : null}
      {card.observed_at === null ? (
        <p className="muted" data-testid="live-none">
          No reading has been stored yet.
        </p>
      ) : (
        <p className="muted small" data-testid="live-asof">
          As of {formatKl(card.observed_at)}
          {card.received_at ? `, received ${formatKl(card.received_at)}` : ''}.
        </p>
      )}
      <dl className="details" data-testid="live-readings">
        <dt>Battery</dt>
        <dd>{percent(r.battery_percent)}</dd>
        <dt>Range</dt>
        <dd>{km(r.range_km)}</dd>
        <dt>Plugged in</dt>
        <dd>{yesNo(r.plugged_in)}</dd>
        <dt>Charging</dt>
        <dd>{yesNo(r.charging)}</dd>
        <dt>Tyre, driver front</dt>
        <dd>{kpa(t.driver_front)}</dd>
        <dt>Tyre, passenger front</dt>
        <dd>{kpa(t.passenger_front)}</dd>
        <dt>Tyre, driver rear</dt>
        <dd>{kpa(t.driver_rear)}</dd>
        <dt>Tyre, passenger rear</dt>
        <dd>{kpa(t.passenger_rear)}</dd>
        <dt>Odometer</dt>
        <dd>{km(r.odometer_km)}</dd>
        <dt>Next service in</dt>
        <dd>
          {km(r.service_distance_km)}, {days(r.service_days)}
        </dd>
      </dl>
      <p className="muted small">
        Updates about every {card.interval_minutes} minutes while this page is open.
      </p>
      <Link to="/vehicle/live" className="button">
        History
      </Link>
    </>
  );
}
