import { useCallback, useEffect, useState } from 'react';
import { request } from '../api/client';
import type { GeofenceMap } from '../api/types';
import { MUTED, SMALL } from './ListParts';
import { Button } from './ui/button';
import { Card } from './ui/card';

/** Half the drawing's width, in SVG units. Home is at (0, 0). */
const HALF = 100;
/** A car further than this many radii away is drawn on the edge, with an arrow. */
const MAX_RADII = 4;

const MESSAGES: Record<Exclude<GeofenceMap['state'], 'ok' | 'stale'>, string> = {
  off: 'The geofence or live readings are off on the host, so there is no position to show.',
  home_not_set: 'The home point is not set on the host.',
  no_reading: 'No reading from the car yet.',
  incomplete: 'The latest reading has no usable position.',
};

/** A round number of km for the scale bar, about a third of the drawing. */
export function scaleKm(extentKm: number): number {
  const target = (extentKm * 2) / 3;
  const pow = 10 ** Math.floor(Math.log10(target));
  for (const step of [5, 2, 1]) if (step * pow <= target) return step * pow;
  return pow;
}

export function layout(m: GeofenceMap) {
  const car = m.car;
  const distance = car ? Math.hypot(car.east_km, car.north_km) : 0;
  const beyond = distance > m.radius_km * MAX_RADII;
  const shown = Math.min(distance, m.radius_km * MAX_RADII);
  const office = m.office ?? null;
  const officeDistance = office ? Math.hypot(office.east_km, office.north_km) : 0;
  const officeBeyond = officeDistance > m.radius_km * MAX_RADII;
  const officeShown = Math.min(officeDistance, m.radius_km * MAX_RADII);
  const officeReach = office ? officeShown + office.radius_km : 0;
  const extent = Math.max(m.radius_km, shown, officeReach) * 1.2;
  const k = HALF / extent;
  const angle = Math.atan2(car?.north_km ?? 0, car?.east_km ?? 0);
  const officeAngle = Math.atan2(office?.north_km ?? 0, office?.east_km ?? 0);
  return {
    officeBeyond,
    officeX: Math.cos(officeAngle) * officeShown * k,
    officeY: -Math.sin(officeAngle) * officeShown * k,
    officeAngle,
    distance,
    beyond,
    extent,
    k,
    // SVG y grows downwards, so north is negative y.
    x: Math.cos(angle) * shown * k,
    y: -Math.sin(angle) * shown * k,
    angle,
  };
}

function ago(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 1) return 'less than a minute old';
  return minutes === 1 ? '1 minute old' : `${minutes} minutes old`;
}

/** Online only: the map is never saved on the device (AC-96). */
export function GeofenceMapCard() {
  const [map, setMap] = useState<GeofenceMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await request<GeofenceMap>({ method: 'GET', path: '/geofence/map' });
        if (!live) return;
        setMap(r.data);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the map.');
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [round]);

  const load = useCallback(() => {
    setBusy(true);
    setRound((n) => n + 1);
  }, []);

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="geo-map">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-base">Map</h2>
        <Button variant="outline" onClick={load} disabled={busy}>
          {busy ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {map === null ? null : map.car === null || map.car === undefined ? (
        <p className={`m-0 ${MUTED}`} data-testid="geo-map-message">
          {MESSAGES[map.state as keyof typeof MESSAGES]}
        </p>
      ) : (
        <Drawing map={map} />
      )}
      <p className={`m-0 ${SMALL}`}>
        Not a street map: home is in the middle and north is up. Uses the last reading the server
        already has; it never asks the car. Positions are rounded to 0.1 km and are not saved on
        this device.
      </p>
    </Card>
  );
}

function Drawing({ map }: { map: GeofenceMap }) {
  const l = layout(map);
  const stale = map.stale;
  const r = map.radius_km * l.k;
  const bar = scaleKm(l.extent);
  const barW = bar * l.k;
  const office = map.office ?? null;
  const where = map.outside ? 'outside' : 'inside';
  const place = map.place ?? null;
  const placeText = office
    ? place === 'office'
      ? 'At the office'
      : place === 'home'
        ? 'At home'
        : 'Outside home and the office'
    : null;
  const radiusText = office
    ? `the ${map.radius_km} km home radius and the ${office.radius_km} km office radius`
    : `the ${map.radius_km} km radius`;
  const label = `Car ${l.distance.toFixed(1)} km from home, ${where} ${radiusText}${
    stale ? ', reading stale' : ''
  }.`;
  const arrowDeg = (-l.angle * 180) / Math.PI;
  const officeArrowDeg = (-l.officeAngle * 180) / Math.PI;
  return (
    <>
      <svg
        viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
        role="img"
        aria-label={label}
        width="100%"
        className="mx-auto block max-h-80 max-w-80"
      >
        <circle
          cx="0"
          cy="0"
          r={r}
          fill="currentColor"
          fillOpacity="0.06"
          stroke="currentColor"
          strokeOpacity="0.5"
          strokeDasharray="4 3"
          data-testid="geo-map-radius"
        />
        <text
          x="0"
          y={-HALF + 8}
          textAnchor="middle"
          fontSize="8"
          fill="currentColor"
          opacity="0.6"
        >
          N
        </text>
        {office ? (
          <g data-testid="geo-map-office">
            <circle
              cx={l.officeX}
              cy={l.officeY}
              r={office.radius_km * l.k}
              fill="currentColor"
              fillOpacity="0.06"
              stroke="currentColor"
              strokeOpacity="0.5"
              strokeDasharray="4 3"
            />
            <rect
              x={l.officeX - 4}
              y={l.officeY - 4}
              width="8"
              height="8"
              rx="2"
              className="fill-primary"
            />
            <text
              x={l.officeX}
              y={l.officeY + 14}
              textAnchor="middle"
              fontSize="8"
              fill="currentColor"
            >
              Office
            </text>
            {l.officeBeyond ? (
              <path
                d="M 0 -4 L 7 0 L 0 4 Z"
                fill="currentColor"
                transform={`translate(${l.officeX} ${l.officeY}) rotate(${officeArrowDeg}) translate(8 0)`}
                data-testid="geo-map-office-beyond"
              />
            ) : null}
          </g>
        ) : null}
        <rect x="-5" y="-5" width="10" height="10" rx="2" className="fill-primary" />
        <text x="0" y="16" textAnchor="middle" fontSize="8" fill="currentColor">
          Home
        </text>
        <g
          data-testid="geo-map-car"
          data-stale={stale ? 'true' : 'false'}
          opacity={stale ? 0.4 : 1}
        >
          <circle
            cx={l.x}
            cy={l.y}
            r="6"
            className={map.outside ? 'fill-warning' : 'fill-success'}
            stroke="currentColor"
            strokeWidth="1"
          />
          {l.beyond ? (
            <path
              d="M 0 -4 L 7 0 L 0 4 Z"
              fill="currentColor"
              transform={`translate(${l.x} ${l.y}) rotate(${arrowDeg}) translate(8 0)`}
              data-testid="geo-map-beyond"
            />
          ) : null}
        </g>
        <g transform={`translate(${-HALF + 6} ${HALF - 8})`}>
          <line x1="0" y1="0" x2={barW} y2="0" stroke="currentColor" strokeWidth="1.5" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="currentColor" />
          <line x1={barW} y1="-3" x2={barW} y2="3" stroke="currentColor" />
          <text x={barW / 2} y="-5" textAnchor="middle" fontSize="7" fill="currentColor">
            {bar} km
          </text>
        </g>
      </svg>
      <p className="m-0" data-testid="geo-map-summary">
        {placeText ? `${placeText}. ` : ''}
        {l.distance.toFixed(1)} km from home, {where} {radiusText}.
        {l.beyond ? ' Too far to draw to scale: shown on the edge, in its direction.' : ''}
        {l.officeBeyond ? ' The office is too far to draw to scale: shown on the edge.' : ''}
      </p>
      <p className={`m-0 ${SMALL}`} data-testid="geo-map-age">
        Reading {ago(map.age_minutes)}
        {stale ? ', stale (older than the stale limit). The car may have moved.' : '.'}
      </p>
    </>
  );
}
