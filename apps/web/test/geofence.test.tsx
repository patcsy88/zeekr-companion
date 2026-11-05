import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath, request } from '../src/api/client';
import type { GeofenceSettings } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { server } from './server';

function settings(
  over: Partial<GeofenceSettings['settings']> = {},
  saved = false,
): GeofenceSettings {
  const origin = saved ? 'saved' : 'env';
  return {
    settings: {
      radius_km: 5,
      interval_minutes: 5,
      stale_minutes: 30,
      gear_codes: [0],
      usage_mode_codes: [0],
      ...over,
    },
    sources: {
      radius_km: origin,
      interval_minutes: origin,
      stale_minutes: origin,
      gear_codes: origin,
      usage_mode_codes: origin,
    },
    limits: {
      radius_km_max: 100,
      interval_minutes_min: 5,
      interval_minutes_max: 1440,
      stale_minutes_min: 1,
      stale_minutes_max: 30,
      max_codes: 5,
      gear_options: [
        { code: 0, label: 'P', verified: true },
        { code: 3, label: 'D', verified: true },
      ],
      usage_mode_options: [
        { code: 0, label: 'Deep Sleep', verified: false },
        { code: 13, label: 'Active', verified: false },
      ],
    },
    enabled: true,
    home_set: true,
  };
}

function open() {
  window.history.pushState(null, '', '/geofence');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('geofence: request paths', () => {
  it('allows only the one settings path', () => {
    expect(() => {
      assertContractPath('/geofence/settings');
    }).not.toThrow();
    for (const bad of [
      '/geofence',
      '/geofence/',
      '/geofence/other',
      '/geofence/settings?x=1',
      '/geofence/settings/x',
      '/geofence/../vehicle',
    ])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });

  it('refuses a bad path without calling fetch', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(request({ method: 'GET', path: '/geofence/x' })).rejects.toMatchObject({
      name: 'ClientError',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('geofence: the tab', () => {
  it('shows the values, the switches as words only, and the no-send note', async () => {
    server.use(http.get('*/api/v1/geofence/settings', () => HttpResponse.json(settings())));
    open();
    render(<App />);
    expect(await screen.findByLabelText(/Radius/)).toHaveValue('5');
    expect(screen.getByTestId('geo-status')).toHaveTextContent('Geofence: on');
    expect(screen.getByTestId('geo-status')).toHaveTextContent('Home point: set');
    expect(screen.getByText(/never sends anything to the car/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Active \(13\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/unverified label/).length).toBeGreaterThan(0);
  });

  it('saves what was entered', async () => {
    const puts: unknown[] = [];
    server.use(
      http.get('*/api/v1/geofence/settings', () => HttpResponse.json(settings())),
      http.put('*/api/v1/geofence/settings', async ({ request: r }) => {
        puts.push(await r.json());
        return HttpResponse.json(settings({ radius_km: 8, gear_codes: [0, 3] }, true));
      }),
    );
    const user = open();
    render(<App />);
    const radius = await screen.findByLabelText(/Radius/);
    await user.clear(radius);
    await user.type(radius, '8');
    await user.click(screen.getByLabelText(/D \(3\)/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/applies at the next check/)).toBeInTheDocument();
    expect(puts).toEqual([
      {
        radius_km: 8,
        interval_minutes: 5,
        stale_minutes: 30,
        gear_codes: [0, 3],
        usage_mode_codes: [0],
      },
    ]);
  });

  it('refuses a stale limit above 30 without calling the server', async () => {
    const puts: unknown[] = [];
    server.use(
      http.get('*/api/v1/geofence/settings', () =>
        HttpResponse.json(settings({ stale_minutes: 1440 })),
      ),
      http.put('*/api/v1/geofence/settings', async ({ request: r }) => {
        puts.push(await r.json());
        return HttpResponse.json(settings());
      }),
    );
    const user = open();
    render(<App />);
    expect(await screen.findByTestId('geo-above-limit')).toHaveTextContent('1440');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 30|1 to 30/);
    expect(puts).toHaveLength(0);
  });

  it('refuses an empty code pick', async () => {
    server.use(http.get('*/api/v1/geofence/settings', () => HttpResponse.json(settings())));
    const user = open();
    render(<App />);
    await user.click(await screen.findByLabelText(/P \(0\)/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick 1 to 5 gear codes');
  });

  it('resets to the host values', async () => {
    let deleted = 0;
    server.use(
      http.get('*/api/v1/geofence/settings', () =>
        HttpResponse.json(settings({ radius_km: 9 }, true)),
      ),
      http.delete('*/api/v1/geofence/settings', () => {
        deleted += 1;
        return HttpResponse.json(settings());
      }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Use the host values' }));
    await waitFor(() => {
      expect(deleted).toBe(1);
    });
    expect(await screen.findByLabelText(/Radius/)).toHaveValue('5');
  });

  it('shows the server error', async () => {
    server.use(
      http.get('*/api/v1/geofence/settings', () => HttpResponse.json(settings())),
      http.put('*/api/v1/geofence/settings', () =>
        HttpResponse.json(
          { error: { code: 'validation_error', message: 'Bad value.', details: [] } },
          { status: 400 },
        ),
      ),
    );
    const user = open();
    render(<App />);
    await screen.findByLabelText(/Radius/);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad value.');
  });
});
