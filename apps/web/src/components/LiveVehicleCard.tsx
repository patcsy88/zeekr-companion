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
  lockState,
  percent,
  serviceKm,
  volts,
  yesNo,
} from '../lib/liveVehicle';
import { Skeleton } from './Skeleton';
import { ReadOnlyToggle } from './ReadOnlyToggle';
import { usePullToRefresh } from '../lib/pullToRefresh';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { HEAD, MUTED, SMALL } from './ListParts';
import { cn } from '../lib/cn';

/** A small label over a reading. */
const LABEL = 'm-0 text-muted-foreground text-xs';
/** Group heading, iOS grouped-list style (the same as on the Vehicle page). */
const GROUP_TITLE =
  'mx-1 mt-5 mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider';

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
    <Card
      render={<section aria-labelledby="live-title" />}
      className="my-3 block px-4 py-3"
      data-testid="live-card"
    >
      <div className={HEAD}>
        <h2 id="live-title" className="m-0">
          Live from the car
        </h2>
        {active && status !== 'off' && status !== 'paused' ? (
          <Button variant="outline" disabled={busy} onClick={refresh}>
            Refresh
          </Button>
        ) : null}
      </div>
      <p className={SMALL}>
        Readings only. Nothing here is sent to the car. The Sentry switch is on the Sentry tab.
      </p>
      {!session.signedIn || !online ? (
        <p className={MUTED} data-testid="live-offline">
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
    </Card>
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
        <p className={MUTED} data-testid="live-off">
          Live readings are off.
        </p>
        <Button variant="outline" size="lg" render={<Link to="/vehicle/live" />}>
          History
        </Button>
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
        <Alert variant="error" className="my-2" data-testid="live-paused">
          <AlertDescription className="text-destructive-foreground">
            Live readings are paused after repeated failures. They stay paused until the API is
            restarted.
          </AlertDescription>
        </Alert>
      ) : null}
      {card.status === 'unavailable' ? (
        <Alert variant="error" className="my-2" data-testid="live-unavailable">
          <AlertDescription className="text-destructive-foreground">
            Could not get a new reading. Showing the last one stored.
          </AlertDescription>
        </Alert>
      ) : null}
      {failed ? (
        <Alert variant="error" className="my-2">
          <AlertDescription className="text-destructive-foreground">
            Could not refresh. Showing the last reading received.
          </AlertDescription>
        </Alert>
      ) : null}
      {note ? (
        <Alert variant="info" role="status" className="my-2" data-testid="live-note">
          <AlertDescription className="text-info-foreground">{note}</AlertDescription>
        </Alert>
      ) : null}
      {card.observed_at === null ? (
        <p className={MUTED} data-testid="live-none">
          No reading has been stored yet.
        </p>
      ) : (
        <p className={SMALL} data-testid="live-asof">
          As of {formatKl(card.observed_at)}
          {card.received_at ? `, received ${formatKl(card.received_at)}` : ''}.
        </p>
      )}
      <div data-testid="live-readings">
        <div className="pt-1 pb-2">
          <p className={cn(LABEL, 'dash-label')}>Battery</p>
          <p className="m-0 font-bold text-[2.6rem] tabular-nums leading-[1.1] tracking-tight">
            {percent(r.battery_percent)}
          </p>
          {r.battery_percent !== null ? (
            <div
              className="my-1.5 h-2.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Battery level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(r.battery_percent)}
            >
              <div
                className={cn(
                  'h-full transition-[width] duration-400',
                  r.battery_percent <= 20 ? 'bg-destructive' : 'bg-primary',
                )}
                style={{ width: `${Math.min(100, Math.max(0, r.battery_percent))}%` }}
              />
            </div>
          ) : null}
          <p className="m-0 mt-2 flex flex-wrap gap-1.5">
            <Flagged label="Plugged in" value={r.plugged_in} />
            <Flagged label="Charging" value={r.charging} />
          </p>
        </div>
        <dl className="m-0 my-3 grid grid-cols-2 gap-2">
          <Stat label="Range" value={km(r.range_km)} />
          <Stat label="Odometer" value={km(r.odometer_km)} />
          <Stat label="12 V battery" value={volts(r.battery_12v_volts)} />
          <Stat
            label="Next service in"
            value={`${serviceKm(r.service_distance_km)}, ${days(r.service_days)}`}
          />
          <Stat
            className="col-span-2"
            label="Central locking"
            value={lockState(card.central_locking)}
            testId="live-central-locking"
          />
        </dl>
        <h3 className={GROUP_TITLE}>Tyres</h3>
        <div className="my-2 grid grid-cols-[1fr_minmax(3rem,4.5rem)_1fr] grid-rows-[auto_auto] items-center gap-2">
          <Tyre label="Passenger front" kpaValue={t.passenger_front} c={tc.passenger_front} />
          <CarOutline />
          <Tyre label="Driver front" kpaValue={t.driver_front} c={tc.driver_front} />
          <Tyre label="Passenger rear" kpaValue={t.passenger_rear} c={tc.passenger_rear} />
          <Tyre label="Driver rear" kpaValue={t.driver_rear} c={tc.driver_rear} />
        </div>
      </div>
      <h3 className={GROUP_TITLE}>Reported on / off</h3>
      <dl
        className="m-0 mb-3 overflow-hidden rounded-2xl border bg-muted [&>div]:flex [&>div]:min-h-11 [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:px-4 [&>div]:py-2 [&>div+div]:border-t [&_dd]:m-0 [&_dd]:text-right [&_dd]:text-muted-foreground"
        data-testid="live-indicators"
      >
        <Flag label="Pre-climate" value={ind.pre_climate_active} />
        <Flag label="Fragrance" value={ind.fragrance_active} />
        <Flag label="Overheat protection" value={ind.overheat_protection_active} />
        <Flag label="VTM TS" value={ind.vtm_ts_active} />
        <Flag label="Engine enable running" value={ind.engine_enable_running} />
      </dl>
      <p className={SMALL}>
        These are the car's own reported flags. Their exact meanings are not verified, and this page
        cannot change any of them.
      </p>
      <p className={SMALL}>
        Updates about every {card.interval_minutes} minutes while this page is open.
      </p>
      <Button variant="outline" size="lg" render={<Link to="/vehicle/live" />}>
        History
      </Button>
    </>
  );
}

function Stat({
  label,
  value,
  className,
  testId,
}: {
  label: string;
  value: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn('rounded-xl bg-muted px-3 py-2', className)} data-testid={testId}>
      <dt className={LABEL}>{label}</dt>
      <dd className="m-0 mt-0.5 font-semibold text-lg tabular-nums">{value}</dd>
    </div>
  );
}

function Flag({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <ReadOnlyToggle label={label} value={value} />
      </dd>
    </div>
  );
}

/** A plain top view of a car, front at the top, between the four tyre readings. */
function CarOutline() {
  return (
    <svg
      className="col-start-2 row-span-2 row-start-1 max-h-34 w-full text-muted-foreground opacity-55"
      viewBox="0 0 60 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="4" width="44" height="112" rx="16" />
      <path d="M14 34c10-6 22-6 32 0l-3 12H17zM17 84h26l3 10c-10 5-22 5-32 0z" />
    </svg>
  );
}

/** A yes / no badge: green when on, plain when off, dashed when the car did not say. */
function Flagged({ label, value }: { label: string; value: boolean | null }) {
  return (
    <Badge
      variant={value ? 'success' : 'outline'}
      size="lg"
      className={
        value === null
          ? 'border-dashed text-muted-foreground'
          : value
            ? ''
            : 'text-muted-foreground'
      }
    >
      {label}: {yesNo(value)}
    </Badge>
  );
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
    // "tyre" and "dash-label" stay as hooks for the tests that read the tyre order.
    <div className="tyre rounded-xl border bg-muted px-2.5 py-2 [&:nth-of-type(even)]:col-start-3 [&:nth-of-type(even)]:text-right [&:nth-of-type(odd)]:col-start-1">
      <p className={cn(LABEL, 'dash-label')}>{label}</p>
      <p className="m-0 mt-0.5 font-semibold tabular-nums">
        {kpa(kpaValue)}, {celsius(c)}
      </p>
    </div>
  );
}
