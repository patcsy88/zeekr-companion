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
  celsius,
  volts,
  type Point,
} from '../lib/liveVehicle';
import { ACTIONS, ERROR } from '../components/Field';
import { HEAD, LIST, MUTED, NOTICE, SMALL } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { cn } from '../lib/cn';

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
      <div className={HEAD}>
        <h1 id="live-history-title">Live reading history</h1>
        <Button variant="outline" size="lg" render={<Link to="/vehicle" />}>
          Back
        </Button>
      </div>
      <p className={SMALL}>
        Read-only. Readings are stored only while the Vehicle page is open, so there are gaps.
      </p>
    </>
  );

  if (!active) {
    return (
      <section aria-labelledby="live-history-title">
        {header}
        <p className={MUTED} data-testid="live-offline">
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
        <p role="alert" className={ERROR}>
          Could not load the history.
        </p>
      ) : null}
      {deleted !== null ? (
        <p role="status" className={NOTICE.info} data-testid="live-deleted">
          Deleted {deleted} {deleted === 1 ? 'reading' : 'readings'}.
        </p>
      ) : null}
      {data === null ? (
        <p role="status">{error ? '' : 'Loading…'}</p>
      ) : items.length === 0 ? (
        <p className={MUTED} data-testid="live-history-empty">
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
          <p className={SMALL}>
            Showing the newest {items.length} readings. Readings older than {data.retention_months}{' '}
            months are removed.
          </p>
          <ul className={LIST} aria-label="Stored readings" data-testid="live-history-list">
            {items.map((i, n) => {
              const older = items[n + 1];
              const gap = older && isGap(i.observed_at, older.observed_at, interval);
              return (
                <Card render={<li />} key={i.id} className="gap-1 p-3 [&_p]:my-0">
                  <h2 className="m-0 text-sm">{formatKl(i.observed_at)}</h2>
                  <p className="text-sm">
                    Battery {percent(i.battery_percent)} · Range {km(i.range_km)} · Odometer{' '}
                    {km(i.odometer_km)}
                  </p>
                  <p className={SMALL}>
                    Plugged in {yesNo(i.plugged_in)} · Charging {yesNo(i.charging)} · Tyres{' '}
                    {kpa(i.tyres_kpa.driver_front)}, {kpa(i.tyres_kpa.passenger_front)},{' '}
                    {kpa(i.tyres_kpa.driver_rear)}, {kpa(i.tyres_kpa.passenger_rear)} · Service in{' '}
                    {serviceKm(i.service_distance_km)}, {days(i.service_days)}
                  </p>
                  <p className={SMALL}>
                    12 V {volts(i.battery_12v_volts)} · Tyre temperatures{' '}
                    {celsius(i.tyres_celsius.driver_front)},{' '}
                    {celsius(i.tyres_celsius.passenger_front)},{' '}
                    {celsius(i.tyres_celsius.driver_rear)},{' '}
                    {celsius(i.tyres_celsius.passenger_rear)}
                  </p>
                  <p className={SMALL}>
                    Pre-climate {yesNo(i.indicators.pre_climate_active)} · Fragrance{' '}
                    {yesNo(i.indicators.fragrance_active)} · Overheat protection{' '}
                    {yesNo(i.indicators.overheat_protection_active)} · VTM TS{' '}
                    {yesNo(i.indicators.vtm_ts_active)} · Engine enable running{' '}
                    {yesNo(i.indicators.engine_enable_running)} · Sentry{' '}
                    {yesNo(i.indicators.sentry_active)}
                  </p>
                  {gap && older ? (
                    <p className={NOTICE.info} data-testid="live-gap">
                      No readings for{' '}
                      {formatSpan(
                        new Date(i.observed_at).getTime() - new Date(older.observed_at).getTime(),
                      )}{' '}
                      before this one.
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        </>
      )}
      {items.length > 0 ? (
        confirming ? (
          <div className={NOTICE.bad} role="alertdialog" aria-label="Confirm delete">
            <p>Delete all stored readings? This cannot be undone.</p>
            <div className={cn(ACTIONS, 'mt-2')}>
              <Button variant="destructive" disabled={busy} onClick={() => void deleteAll()}>
                Yes, delete all
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete all history
          </Button>
        )
      ) : null}
    </section>
  );
}
