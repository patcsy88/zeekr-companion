import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/client';
import type { LiveCard } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import {
  celsius,
  days,
  formatKl,
  km,
  kpa,
  percent,
  serviceKm,
  volts,
  yesNo,
} from '../lib/liveVehicle';
import { Skeleton } from './Skeleton';
import { ReadOnlyToggle } from './ReadOnlyToggle';
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
      <p className="muted small">
        Readings only. Nothing here is sent to the car. The Sentry switch is on the Sentry tab.
      </p>
      {!session.signedIn || !online ? (
        <p className="muted" data-testid="live-offline">
          Needs a connection.
        </p>
      ) : card === null ? (
        failed ? (
          <p role="status">Could not load live readings.</p>
        ) : (
          <Skeleton lines={4} />
        )
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
      <>
        <p className="muted" data-testid="live-off">
          Live readings are off.
        </p>
        <Link to="/vehicle/live" className="button">
          History
        </Link>
      </>
    );
  }
  const r = card.readings;
  const t = r.tyres_kpa;
  const tc = r.tyres_celsius;
  const ind = r.indicators;
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
      <div className="dash" data-testid="live-readings">
        <div className="dash-hero">
          <p className="dash-label">Battery</p>
          <p className="dash-big">{percent(r.battery_percent)}</p>
          {r.battery_percent !== null ? (
            <div
              className="bar"
              role="progressbar"
              aria-label="Battery level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(r.battery_percent)}
            >
              <div
                className={`bar-fill${r.battery_percent <= 20 ? ' bar-low' : ''}`}
                style={{ width: `${Math.min(100, Math.max(0, r.battery_percent))}%` }}
              />
            </div>
          ) : null}
          <p className="dash-range">
            <span className="dash-label">Range</span> <strong>{km(r.range_km)}</strong>
          </p>
          <p className="badges">
            <span className={badgeClass(r.plugged_in)}>Plugged in: {yesNo(r.plugged_in)}</span>
            <span className={badgeClass(r.charging)}>Charging: {yesNo(r.charging)}</span>
          </p>
        </div>
        <div className="tyres">
          <Tyre label="Passenger front" kpaValue={t.passenger_front} c={tc.passenger_front} />
          <Tyre label="Driver front" kpaValue={t.driver_front} c={tc.driver_front} />
          <Tyre label="Passenger rear" kpaValue={t.passenger_rear} c={tc.passenger_rear} />
          <Tyre label="Driver rear" kpaValue={t.driver_rear} c={tc.driver_rear} />
        </div>
        <dl className="details">
          <dt>12 V battery</dt>
          <dd>{volts(r.battery_12v_volts)}</dd>
          <dt>Odometer</dt>
          <dd>{km(r.odometer_km)}</dd>
          <dt>Next service in</dt>
          <dd>
            {serviceKm(r.service_distance_km)}, {days(r.service_days)}
          </dd>
        </dl>
      </div>
      <h3 className="small">Reported on / off</h3>
      <dl className="details" data-testid="live-indicators">
        <dt>Pre-climate</dt>
        <dd>
          <ReadOnlyToggle label="Pre-climate" value={ind.pre_climate_active} />
        </dd>
        <dt>Fragrance</dt>
        <dd>
          <ReadOnlyToggle label="Fragrance" value={ind.fragrance_active} />
        </dd>
        <dt>Overheat protection</dt>
        <dd>
          <ReadOnlyToggle label="Overheat protection" value={ind.overheat_protection_active} />
        </dd>
        <dt>VTM TS</dt>
        <dd>
          <ReadOnlyToggle label="VTM TS" value={ind.vtm_ts_active} />
        </dd>
        <dt>Engine enable running</dt>
        <dd>
          <ReadOnlyToggle label="Engine enable running" value={ind.engine_enable_running} />
        </dd>
      </dl>
      <p className="muted small">
        These are the car's own reported flags. Their exact meanings are not verified, and this page
        cannot change any of them.
      </p>
      <p className="muted small">
        Updates about every {card.interval_minutes} minutes while this page is open.
      </p>
      <Link to="/vehicle/live" className="button">
        History
      </Link>
    </>
  );
}

function badgeClass(value: boolean | null): string {
  return value === null ? 'badge badge-unknown' : value ? 'badge badge-on' : 'badge';
}

/** One tyre. The grid puts the driver side on the right, because the car is right hand drive. */
function Tyre({
  label,
  kpaValue,
  c,
}: {
  label: string;
  kpaValue: number | null;
  c: number | null;
}) {
  return (
    <div className="tyre">
      <p className="dash-label">{label}</p>
      <p className="tyre-value">
        {kpa(kpaValue)}, {celsius(c)}
      </p>
    </div>
  );
}
