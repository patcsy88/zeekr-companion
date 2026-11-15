import { Link } from 'react-router-dom';
import { BasisNote } from '../components/ReminderParts';
import { Skeleton } from '../components/Skeleton';
import {
  EmptyState,
  HEAD,
  ITEM_BODY,
  ItemCard,
  LIST,
  META,
  MUTED,
  NOTICE,
  SMALL,
  TITLE,
} from '../components/ListParts';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { SyncBadge } from '../components/SyncBadge';
import { useConnectivity, useSession, useTyreEvents } from '../data/hooks';
import { formatDate } from '../lib/dates';
import { formatMyr } from '../lib/money';
import { currentTyres, type WheelStatus } from '../lib/tyreStatus';
import { KIND_LABELS, NOT_IN_EXPENSES, WHEEL_LABELS, wheelsText } from '../lib/tyreText';

function since(km: number | null): string {
  return km === null ? '' : `, ${km.toLocaleString()} km ago`;
}

function WheelRow({ s }: { s: WheelStatus }) {
  const r = s.replaced;
  const tyre = r ? [r.brand, r.model, r.size].filter(Boolean).join(' ') : '';
  return (
    <div
      data-testid={`wheel-${s.wheel}`}
      className="flex flex-col gap-0.5 px-4 py-2.5 not-first:border-border not-first:border-t"
    >
      <dt className="font-medium">{WHEEL_LABELS[s.wheel]}</dt>
      <dd className="m-0 text-muted-foreground text-sm [overflow-wrap:anywhere]">
        {r ? (
          <>
            {tyre || 'Tyre details not recorded'}. Replaced{' '}
            <time dateTime={r.date}>{formatDate(r.date)}</time> at {r.odometer.toLocaleString()} km
            {since(s.kmSinceReplace)}.
          </>
        ) : (
          'No replacement recorded.'
        )}
        {s.rotated ? (
          <>
            {' '}
            Last rotated <time dateTime={s.rotated.date}>{formatDate(s.rotated.date)}</time> at{' '}
            {s.rotated.odometer.toLocaleString()} km{since(s.kmSinceRotate)}.
          </>
        ) : null}
      </dd>
    </div>
  );
}

export function TyresPage() {
  const snap = useTyreEvents();
  const { online } = useConnectivity();
  const session = useSession();
  if (snap === undefined) return <Skeleton />;
  const events = snap.views.map((v) => v.event);
  const status = currentTyres(events, snap.basis?.km ?? null);
  const empty = snap.views.length === 0;

  return (
    <section aria-labelledby="tyres-title">
      <p>
        <Link to="/vehicle">Back to vehicle</Link>
      </p>
      <div className={HEAD}>
        <h1 id="tyres-title">Tyres</h1>
        <Button size="lg" render={<Link to="/vehicle/tyres/new" />}>
          Add tyre event
        </Button>
      </div>
      <p className={SMALL} data-testid="not-in-expenses">
        {NOT_IN_EXPENSES}
      </p>

      {!snap.loaded && empty ? (
        <p className={MUTED}>
          {session.signedIn
            ? online
              ? 'Loading tyre events…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your tyre events.'}
        </p>
      ) : (
        <>
          <Card render={<section />} aria-labelledby="current-tyres-title" className="mb-4 p-4">
            <h2 id="current-tyres-title">Current tyres</h2>
            {snap.partial ? (
              <p role="status" className={NOTICE.bad} data-testid="partial-warning">
                Partial: not all tyre events are saved on this device, so this may be out of date.
              </p>
            ) : null}
            <BasisNote basis={snap.basis} />
            <dl className="m-0 my-3 overflow-hidden rounded-xl border border-border">
              {status.map((s) => (
                <WheelRow key={s.wheel} s={s} />
              ))}
            </dl>
            <p className={SMALL}>Worked out on this device from the events below.</p>
          </Card>

          {empty ? (
            <EmptyState
              title="No tyre events yet."
              hint="Use Add tyre event at the top to record the first one."
            />
          ) : (
            <ul className={LIST} aria-label="Tyre events, newest first">
              {snap.views.map(({ event: e, sync }) => (
                <ItemCard key={e.id}>
                  <Link to={`/vehicle/tyres/${e.id}`} className={ITEM_BODY}>
                    <span className={TITLE}>
                      {KIND_LABELS[e.kind]} · {wheelsText(e.wheels)}
                    </span>
                    <span className={META}>
                      <time dateTime={e.date}>{formatDate(e.date)}</time> ·{' '}
                      {e.odometer.toLocaleString()} km
                      {e.cost_minor !== null ? ` · ${formatMyr(e.cost_minor)}` : ''}
                    </span>
                    {e.notes ? <span className={META}>{e.notes}</span> : null}
                  </Link>
                  <SyncBadge sync={sync} />
                </ItemCard>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
