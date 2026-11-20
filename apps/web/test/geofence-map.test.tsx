import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { assertContractPath } from '../src/api/client';
import type { GeofenceMap } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { layout, scaleKm } from '../src/components/GeofenceMapCard';
import { reportReachable } from '../src/lib/connectivity';
import { getDb } from '../src/storage/db';
import { fake, server } from './server';

// Every value here is made up.
function map(over: Partial<GeofenceMap> = {}): GeofenceMap {
  return {
    state: 'ok',
    radius_km: 5,
    car: { east_km: 3, north_km: 4 },
    outside: false,
    place: 'home',
    office: null,
    observed_at: '2026-11-17T02:15:00Z',
    age_minutes: 4,
    stale: false,
    ...over,
  };
}

const SETTINGS = {
  settings: {
    radius_km: 5,
    office_radius_km: 2,
    interval_minutes: 5,
    stale_minutes: 30,
    usage_mode_codes: [0],
  },
  sources: {
    radius_km: 'env',
    office_radius_km: 'env',
    interval_minutes: 'env',
    stale_minutes: 'env',
    usage_mode_codes: 'env',
  },
  limits: {
    radius_km_max: 100,
    interval_minutes_min: 5,
    interval_minutes_max: 1440,
    stale_minutes_min: 1,
    stale_minutes_max: 30,
    max_codes: 2,
    usage_mode_options: [
      { code: 0, label: 'Deep Sleep', verified: false },
      { code: 1, label: 'Parked', verified: false },
    ],
  },
  enabled: true,
  home_set: true,
  office_set: false,
};

function serve(...bodies: GeofenceMap[]) {
  let n = 0;
  server.use(
    http.get('*/api/v1/geofence/settings', () => HttpResponse.json(SETTINGS)),
    http.get('*/api/v1/geofence/map', () => {
      const body = bodies[Math.min(n, bodies.length - 1)];
      n += 1;
      return HttpResponse.json(body);
    }),
  );
  return () => n;
}

let rendered = false;

function open() {
  window.history.pushState(null, '', '/geofence');
  setToken('tok-test', 3600);
  rendered = true;
  return userEvent.setup();
}

// Let the app-start sync finish its IndexedDB writes before the shared teardown closes the database.
afterEach(async () => {
  if (!rendered) return;
  rendered = false;
  await waitFor(() => {
    expect(fake.templateGets).toBeGreaterThan(0);
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
});

describe('AC-96: geofence map, request path', () => {
  it('allows /geofence/map and nothing else new', () => {
    expect(() => {
      assertContractPath('/geofence/map');
    }).not.toThrow();
    for (const bad of ['/geofence/map?x=1', '/geofence/map/x', '/geofence/maps'])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });
});

describe('AC-96: geofence map, drawing maths', () => {
  it('puts north up and east right, to scale', () => {
    const l = layout(map({ car: { east_km: 3, north_km: 4 } }));
    expect(l.distance).toBeCloseTo(5);
    expect(l.x).toBeGreaterThan(0);
    expect(l.y).toBeLessThan(0);
    expect(Math.hypot(l.x, l.y) / l.k).toBeCloseTo(5);
    expect(l.beyond).toBe(false);
  });

  it('clamps a far car to the edge and flags it', () => {
    const l = layout(map({ car: { east_km: -300, north_km: 0 }, outside: true }));
    expect(l.beyond).toBe(true);
    expect(Math.hypot(l.x, l.y) / l.k).toBeCloseTo(20);
    expect(l.x).toBeLessThan(0);
  });

  it('fits a near office inside the drawing and flags a far one', () => {
    const near = layout(
      map({ office: { east_km: 11, north_km: 0, radius_km: 2 }, car: { east_km: 3, north_km: 4 } }),
    );
    expect(near.officeBeyond).toBe(false);
    expect(near.officeX).toBeGreaterThan(0);
    expect(Math.abs(near.officeY)).toBeCloseTo(0);
    expect(near.officeX + 2 * near.k).toBeLessThanOrEqual(100 + 0.001);
    const far = layout(map({ office: { east_km: 0, north_km: -80, radius_km: 2 } }));
    expect(far.officeBeyond).toBe(true);
    expect(far.officeY).toBeGreaterThan(0);
  });

  it('picks a round scale bar', () => {
    expect(scaleKm(6)).toBe(2);
    expect(scaleKm(24)).toBe(10);
    expect(scaleKm(1.2)).toBe(0.5);
  });
});

describe('AC-96: geofence map on the tab', () => {
  it('draws home, the radius and the car, with distance and age', async () => {
    serve(map());
    open();
    render(<App />);
    const card = await screen.findByTestId('geo-map');
    const img = await within(card).findByRole('img');
    expect(img).toHaveAccessibleName('Car 5.0 km from home, inside the 5 km radius.');
    expect(within(card).getByTestId('geo-map-radius')).toBeInTheDocument();
    expect(within(card).getByTestId('geo-map-car')).toHaveAttribute('data-stale', 'false');
    expect(within(card).getByTestId('geo-map-summary')).toHaveTextContent(
      '5.0 km from home, inside the 5 km radius.',
    );
    expect(within(card).getByTestId('geo-map-age')).toHaveTextContent('Reading 4 minutes old.');
    expect(within(card).queryByTestId('geo-map-beyond')).not.toBeInTheDocument();
    expect(within(card).getByText(/never asks the car/)).toBeInTheDocument();
  });

  it('draws the office as a second circle and says where the car is', async () => {
    serve(
      map({
        office: { east_km: 6, north_km: -2, radius_km: 2 },
        car: { east_km: 6.5, north_km: -2 },
        place: 'office',
      }),
    );
    open();
    render(<App />);
    const card = await screen.findByTestId('geo-map');
    expect(await within(card).findByTestId('geo-map-office')).toHaveTextContent('Office');
    expect(within(card).getByRole('img')).toHaveAccessibleName(
      'Car 6.8 km from home, inside the 5 km home radius and the 2 km office radius.',
    );
    expect(within(card).getByTestId('geo-map-summary')).toHaveTextContent('At the office.');
    expect(within(card).queryByTestId('geo-map-office-beyond')).not.toBeInTheDocument();
  });

  it('says the car is outside home and the office, and flags an office too far to draw', async () => {
    serve(
      map({
        office: { east_km: 0, north_km: 90, radius_km: 2 },
        car: { east_km: 8, north_km: 0 },
        outside: true,
        place: null,
      }),
    );
    open();
    render(<App />);
    const card = await screen.findByTestId('geo-map');
    expect(await within(card).findByTestId('geo-map-office-beyond')).toBeInTheDocument();
    expect(within(card).getByTestId('geo-map-summary')).toHaveTextContent(
      'Outside home and the office.',
    );
    expect(within(card).getByTestId('geo-map-summary')).toHaveTextContent(
      'The office is too far to draw to scale',
    );
  });

  it('draws no office when none is set', async () => {
    serve(map());
    open();
    render(<App />);
    const card = await screen.findByTestId('geo-map');
    await within(card).findByRole('img');
    expect(within(card).queryByTestId('geo-map-office')).not.toBeInTheDocument();
    expect(within(card).getByTestId('geo-map-summary')).not.toHaveTextContent('At home');
  });

  it('greys out a stale reading and says so', async () => {
    serve(map({ state: 'stale', stale: true, outside: true, age_minutes: 45 }));
    open();
    render(<App />);
    const car = await screen.findByTestId('geo-map-car');
    expect(car).toHaveAttribute('data-stale', 'true');
    expect(screen.getByTestId('geo-map-age')).toHaveTextContent(
      'Reading 45 minutes old, stale (older than the stale limit).',
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Car 5.0 km from home, outside the 5 km radius, reading stale.',
    );
  });

  it('shows a far car on the edge with an arrow', async () => {
    serve(map({ car: { east_km: 0, north_km: -250.4 }, outside: true }));
    open();
    render(<App />);
    expect(await screen.findByTestId('geo-map-beyond')).toBeInTheDocument();
    expect(screen.getByTestId('geo-map-summary')).toHaveTextContent(
      '250.4 km from home, outside the 5 km radius. Too far to draw to scale',
    );
  });

  it.each([
    ['off', 'The geofence or live readings are off on the host'],
    ['home_not_set', 'The home point is not set on the host.'],
    ['no_reading', 'No reading from the car yet.'],
    ['incomplete', 'The latest reading has no usable position.'],
  ] as const)('state %s shows a message and no drawing', async (state, text) => {
    serve(map({ state, car: null, outside: null }));
    open();
    render(<App />);
    expect(await screen.findByTestId('geo-map-message')).toHaveTextContent(text);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('Refresh asks the server again', async () => {
    const calls = serve(map(), map({ car: { east_km: 0, north_km: 9 }, outside: true }));
    const user = open();
    render(<App />);
    await screen.findByText('5.0 km from home, inside the 5 km radius.');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText('9.0 km from home, outside the 5 km radius.'),
    ).toBeInTheDocument();
    expect(calls()).toBe(2);
  });

  it('shows the server error', async () => {
    serve(map());
    server.use(
      http.get('*/api/v1/geofence/map', () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'Something went wrong.' } },
          { status: 500 },
        ),
      ),
    );
    open();
    render(<App />);
    const card = await screen.findByTestId('geo-map');
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
  });

  it('saves nothing about the position on the device', async () => {
    serve(map({ car: { east_km: 3.7, north_km: -2.9 } }));
    open();
    render(<App />);
    await screen.findByTestId('geo-map-car');
    const db = await getDb();
    const dump = JSON.stringify({
      cache: await db.getAll('cache'),
      queue: await db.getAll('queue'),
      meta: await db.getAll('meta'),
    });
    expect(dump).not.toContain('east_km');
    expect(dump).not.toContain('3.7');
    expect(dump).not.toContain('geofence');
  });

  it('offline it hides the map and says it needs a connection', async () => {
    const calls = serve(map());
    open();
    render(<App />);
    await screen.findByTestId('geo-map-car');
    await new Promise((resolve) => setTimeout(resolve, 150));
    reportReachable(false);
    expect(
      await screen.findByText(/The geofence map and settings need a sign-in and a connection/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('geo-map')).not.toBeInTheDocument();
    });
    expect(calls()).toBe(1);
  });
});
