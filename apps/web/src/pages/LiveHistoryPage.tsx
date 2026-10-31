import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/client';
import type { LiveDelete, LiveHistory } from '../api/types';
import { LiveTrend } from '../components/LiveTrend';
import { useConnectivity, useSession } from '../data/hooks';
import {
  days,
  formatKl,
  formatSpan,
  isGap,
  km,
  kpa,
  percent,
  serviceKm,
  yesNo,
  type Point,
} from '../lib/liveVehicle';

const LIMIT = 500;

/** Stored live readings: a list, a trend for battery and odometer, and delete-all. Online only. */
export function LiveHistoryPage() {
  const session = useSession();
  const { online } = useConnectivity();
  const [data, setData] = useState<LiveHistory | null>(null);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState<number | null>(null);
  const active = session.signedIn && online;

  const load = useCallback(async () => {
    try {
      const r = await request<LiveHistory>({
        method: 'GET',
        path: `/live-vehicle/history?limit=${LIMIT}`,
      });
      setData(r.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (active) void Promise.resolve().then(load);
  }, [active, load]);

  async function deleteAll() {
    setBusy(true);
    try {
      const r = await request<LiveDelete>({
        method: 'DELETE',
        path: '/live-vehicle/history?confirm=delete_all',
      });
      setDeleted(r.data.deleted);
      setConfirming(false);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <>
      <div className="row">
        <h1 id="live-history-title">Live reading history</h1>
        <Link to="/vehicle" className="button">
          Back
        </Link>
      </div>
      <p className="muted small">
        Read-only. Readings are stored only while the Vehicle page is open, so there are gaps.
      </p>
    </>
  );

  if (!active) {
    return (
      <section aria-labelledby="live-history-title">
        {header}
        <p className="muted" data-testid="live-offline">
          Needs a connection.
        </p>
      </section>
    );
  }

  const items = data?.items ?? [];
  const interval = data?.interval_minutes ?? 5;
  const series = (pick: (i: (typeof items)[number]) => number | null): Point[] =>
    items.flatMap((i) => {
      const v = pick(i);
      return v === null ? [] : [{ t: new Date(i.observed_at).getTime(), v }];
    });

  return (
    <section aria-labelledby="live-history-title">
      {header}
      {error ? (
        <p role="alert" className="error">
          Could not load the history.
        </p>
      ) : null}
      {deleted !== null ? (
        <p role="status" className="notice info" data-testid="live-deleted">
          Deleted {deleted} {deleted === 1 ? 'reading' : 'readings'}.
        </p>
      ) : null}
      {data === null ? (
        <p role="status">{error ? '' : 'Loading…'}</p>
      ) : items.length === 0 ? (
        <p className="muted" data-testid="live-history-empty">
          No readings stored yet.
        </p>
      ) : (
        <>
          <LiveTrend
            title="Battery"
            points={series((i) => i.battery_percent)}
            intervalMinutes={interval}
            fixed={[0, 100]}
            unit="%"
          />
          <LiveTrend
            title="Odometer"
            points={series((i) => i.odometer_km)}
            intervalMinutes={interval}
            unit=" km"
          />
          <p className="muted small">
            Showing the newest {items.length} readings. Readings older than {data.retention_months}{' '}
            months are removed.
          </p>
          <ul className="list" aria-label="Stored readings" data-testid="live-history-list">
            {items.map((i, n) => {
              const older = items[n + 1];
              const gap = older && isGap(i.observed_at, older.observed_at, interval);
              return (
                <li key={i.id}>
                  <h2 className="small">{formatKl(i.observed_at)}</h2>
                  <p className="small">
                    Battery {percent(i.battery_percent)} · Range {km(i.range_km)} · Odometer{' '}
                    {km(i.odometer_km)}
                  </p>
                  <p className="small muted">
                    Plugged in {yesNo(i.plugged_in)} · Charging {yesNo(i.charging)} · Tyres{' '}
                    {kpa(i.tyres_kpa.driver_front)}, {kpa(i.tyres_kpa.passenger_front)},{' '}
                    {kpa(i.tyres_kpa.driver_rear)}, {kpa(i.tyres_kpa.passenger_rear)} · Service in{' '}
                    {serviceKm(i.service_distance_km)}, {days(i.service_days)}
                  </p>
                  {gap && older ? (
                    <p className="notice info" data-testid="live-gap">
                      No readings for{' '}
                      {formatSpan(
                        new Date(i.observed_at).getTime() - new Date(older.observed_at).getTime(),
                      )}{' '}
                      before this one.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {items.length > 0 ? (
        confirming ? (
          <div className="notice bad" role="alertdialog" aria-label="Confirm delete">
            <p>Delete all stored readings? This cannot be undone.</p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => void deleteAll()}>
                Yes, delete all
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete all history
          </button>
        )
      ) : null}
    </section>
  );
}
