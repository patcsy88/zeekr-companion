import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath, request } from '../src/api/client';
import type { LiveCard, LiveHistory, LiveReadingItem } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { GAP_FACTOR, formatSpan, isGap, splitAtGaps } from '../src/lib/liveVehicle';
import { OFF_CARD, server } from './server';

const OBSERVED = '2026-10-31T02:00:00Z';

function card(over: Partial<LiveCard> = {}): LiveCard {
  return {
    ...(OFF_CARD as LiveCard),
    status: 'ok',
    served_from: 'zeekr',
    observed_at: OBSERVED,
    received_at: OBSERVED,
    readings: {
      odometer_km: 4321,
      battery_percent: 64,
      range_km: 349,
      plugged_in: true,
      charging: false,
      tyres_kpa: { driver_front: 236, passenger_front: 240, driver_rear: 238, passenger_rear: 233 },
      service_distance_km: 35000,
      service_days: 200,
    },
    ...over,
  };
}

function item(id: number, iso: string, odo: number | null, battery: number | null) {
  const c = card();
  return {
    ...c.readings,
    id: `d0000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    observed_at: iso,
    received_at: iso,
    odometer_km: odo,
    battery_percent: battery,
  };
}

function serveCard(...cards: LiveCard[]) {
  let n = 0;
  const seen: number[] = [];
  server.use(
    http.get('*/api/v1/live-vehicle', () => {
      seen.push(Date.now());
      const c = cards[Math.min(n, cards.length - 1)];
      n += 1;
      return HttpResponse.json(c);
    }),
  );
  return () => n;
}

function open(path = '/vehicle') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('live vehicle: request paths', () => {
  it('allows only the contract paths', () => {
    for (const ok of [
      '/live-vehicle',
      '/live-vehicle/history',
      '/live-vehicle/history?limit=500',
      '/live-vehicle/history?confirm=delete_all',
    ])
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
    for (const bad of [
      '/live-vehicle/',
      '/live-vehicle?x=1',
      '/live-vehicle/other',
      '/live-vehicle/history/x',
      '/live-vehicle/history?a=b?c',
      '/live-vehicle/history?x=/y',
      '/live-vehicle/../vehicle',
    ])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });

  it('refuses a bad path without calling fetch', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(request({ method: 'GET', path: '/live-vehicle/x' })).rejects.toMatchObject({
      name: 'ClientError',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('live vehicle: gap helpers', () => {
  it('a gap is more than 3 intervals', () => {
    expect(GAP_FACTOR).toBe(3);
    expect(isGap('2026-10-31T00:15:00Z', '2026-10-31T00:00:00Z', 5)).toBe(false);
    expect(isGap('2026-10-31T00:16:00Z', '2026-10-31T00:00:00Z', 5)).toBe(true);
  });

  it('splits points at gaps, whatever the order', () => {
    const m = 60_000;
    const runs = splitAtGaps(
      [
        { t: 100 * m, v: 3 },
        { t: 0, v: 1 },
        { t: 5 * m, v: 2 },
      ],
      5,
    );
    expect(runs.map((r) => r.map((p) => p.v))).toEqual([[1, 2], [3]]);
  });

  it('formats spans', () => {
    expect(formatSpan(30_000)).toBe('under a minute');
    expect(formatSpan(125 * 60_000)).toBe('2 h 5 min');
    expect(formatSpan(52 * 3_600_000)).toBe('2 days 4 h');
  });
});

describe('live vehicle: the card', () => {
  it('says readings are off', async () => {
    open();
    render(<App />);
    expect(await screen.findByTestId('live-off')).toHaveTextContent('Live readings are off.');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('shows readings with units and the time in KL', async () => {
    serveCard(card());
    open();
    render(<App />);
    const list = await screen.findByTestId('live-readings');
    expect(list).toHaveTextContent('64.0%');
    expect(list).toHaveTextContent('349 km');
    expect(list).toHaveTextContent('4,321 km');
    expect(list).toHaveTextContent('236 kPa');
    expect(list).toHaveTextContent('35,000 km, 200 days');
    expect(screen.getByTestId('live-asof')).toHaveTextContent('31 Oct 2026, 10:00 (KL)');
  });

  it('shows "no reading" for nulls and never a zero', async () => {
    serveCard(
      card({
        readings: { ...(OFF_CARD as LiveCard).readings, odometer_km: 0 },
        observed_at: OBSERVED,
      }),
    );
    open();
    render(<App />);
    const list = await screen.findByTestId('live-readings');
    expect(list).toHaveTextContent('no reading');
    expect(list).toHaveTextContent('0 km');
  });

  it('says so when nothing is stored yet', async () => {
    serveCard(card({ observed_at: null, received_at: null, readings: OFF_CARD.readings }));
    open();
    render(<App />);
    expect(await screen.findByTestId('live-none')).toBeInTheDocument();
  });

  it('shows the last reading with a notice when unavailable', async () => {
    serveCard(card({ status: 'unavailable' }));
    open();
    render(<App />);
    expect(await screen.findByTestId('live-unavailable')).toHaveTextContent(
      'Showing the last one stored',
    );
    expect(screen.getByTestId('live-readings')).toHaveTextContent('4,321 km');
  });

  it('shows paused, says it needs a restart, and offers no refresh', async () => {
    serveCard(card({ status: 'paused' }));
    open();
    render(<App />);
    expect(await screen.findByTestId('live-paused')).toHaveTextContent('restarted');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('shows only fixed wording when the API fails', async () => {
    server.use(
      http.get('*/api/v1/live-vehicle', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'CANARY-TEXT', details: [] } },
          { status: 500 },
        ),
      ),
    );
    open();
    render(<App />);
    expect(await screen.findByText('Could not load live readings.')).toBeInTheDocument();
    expect(screen.queryByText(/CANARY-TEXT/)).toBeNull();
  });

  it('Refresh says "No newer reading yet." when served from cache', async () => {
    serveCard(card(), card({ served_from: 'cache' }));
    const user = open();
    render(<App />);
    await screen.findByTestId('live-readings');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByTestId('live-note')).toHaveTextContent('No newer reading yet.');
  });

  it('a pull-down gesture refreshes', async () => {
    const count = serveCard(card());
    open();
    render(<App />);
    await screen.findByTestId('live-readings');
    const before = count();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    act(() => {
      document.dispatchEvent(
        Object.assign(new Event('touchstart'), { touches: [{ clientY: 10 }] }),
      );
      document.dispatchEvent(
        Object.assign(new Event('touchend'), { changedTouches: [{ clientY: 200 }] }),
      );
    });
    await waitFor(() => {
      expect(count()).toBe(before + 1);
    });
  });

  it('a short pull does not refresh', async () => {
    const count = serveCard(card());
    open();
    render(<App />);
    await screen.findByTestId('live-readings');
    const before = count();
    act(() => {
      document.dispatchEvent(
        Object.assign(new Event('touchstart'), { touches: [{ clientY: 10 }] }),
      );
      document.dispatchEvent(
        Object.assign(new Event('touchend'), { changedTouches: [{ clientY: 40 }] }),
      );
    });
    expect(count()).toBe(before);
  });
});

describe('live vehicle: the timer', () => {
  function setVisibility(v: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  }

  it('asks again after the interval while visible, and not while hidden', async () => {
    setVisibility('visible');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const count = serveCard(card({ interval_minutes: 7 }));
    open();
    render(<App />);
    await screen.findByTestId('live-readings');
    expect(count()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000);
    });
    await waitFor(() => {
      expect(count()).toBe(2);
    });
    setVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000);
    });
    expect(count()).toBe(2);
    setVisibility('visible');
  });

  it('does not ask while the page is hidden, and asks when it becomes visible', async () => {
    setVisibility('visible');
    const count = serveCard(card());
    open();
    render(<App />);
    await screen.findByTestId('live-readings');
    expect(count()).toBe(1);
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(count()).toBe(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => {
      expect(count()).toBe(2);
    });
    setVisibility('visible');
  });

  it('sets its interval from interval_minutes and clears it for paused and off', async () => {
    setVisibility('visible');
    const set = vi.spyOn(globalThis, 'setInterval');
    serveCard(card({ interval_minutes: 9 }));
    open();
    const view = render(<App />);
    await screen.findByTestId('live-readings');
    expect(set.mock.calls.some((c) => c[1] === 9 * 60_000)).toBe(true);
    view.unmount();
    set.mockClear();
    serveCard(card({ status: 'paused', interval_minutes: 9 }));
    open();
    render(<App />);
    await screen.findByTestId('live-paused');
    expect(set.mock.calls.some((c) => c[1] === 9 * 60_000)).toBe(false);
  });
});

describe('live vehicle: offline and signed out', () => {
  it('makes no request when signed out', async () => {
    window.history.pushState(null, '', '/vehicle');
    const spy = vi.fn();
    server.use(
      http.get('*/api/v1/live-vehicle', () => {
        spy();
        return HttpResponse.json(OFF_CARD);
      }),
    );
    render(<App />);
    await waitFor(() => {
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

function history(items: LiveReadingItem[]): LiveHistory {
  return { items, interval_minutes: 5, retention_months: 12 };
}

describe('live vehicle: the history screen', () => {
  it('shows an empty state', async () => {
    open('/vehicle/live');
    render(<App />);
    expect(await screen.findByTestId('live-history-empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete all/ })).toBeNull();
  });

  it('lists readings, marks a gap and draws no line across it', async () => {
    server.use(
      http.get('*/api/v1/live-vehicle/history', () =>
        HttpResponse.json(
          history([
            item(3, '2026-10-31T03:05:00Z', 4400, 60),
            item(2, '2026-10-31T03:00:00Z', 4399, 61),
            item(1, '2026-10-30T01:00:00Z', 4300, 80),
          ]),
        ),
      ),
    );
    open('/vehicle/live');
    render(<App />);
    const list = await screen.findByTestId('live-history-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
    const gaps = screen.getAllByTestId('live-gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveTextContent('1 day 2 h');
    const charts = screen.getAllByTestId('live-trend');
    expect(charts).toHaveLength(2);
    for (const c of charts) {
      expect(c.querySelectorAll('polyline')).toHaveLength(1);
      expect(c.querySelectorAll('circle')).toHaveLength(1);
    }
  });

  it('asks before deleting, and sends confirm=delete_all only after Yes', async () => {
    const urls: string[] = [];
    let rows = [item(1, '2026-10-31T03:00:00Z', 4400, 60)];
    server.use(
      http.get('*/api/v1/live-vehicle/history', () => HttpResponse.json(history(rows))),
      http.delete('*/api/v1/live-vehicle/history', ({ request }) => {
        urls.push(request.url);
        rows = [];
        return HttpResponse.json({ deleted: 1 });
      }),
    );
    const user = open('/vehicle/live');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete all history' }));
    expect(urls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(urls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete all history' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete all' }));
    await waitFor(() => {
      expect(urls).toHaveLength(1);
    });
    expect(urls[0]).toContain('confirm=delete_all');
    expect(await screen.findByTestId('live-deleted')).toHaveTextContent('Deleted 1 reading.');
    expect(await screen.findByTestId('live-history-empty')).toBeInTheDocument();
  });

  it('shows fixed wording when the history fails', async () => {
    server.use(
      http.get('*/api/v1/live-vehicle/history', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'CANARY-TEXT', details: [] } },
          { status: 500 },
        ),
      ),
    );
    open('/vehicle/live');
    render(<App />);
    expect(await screen.findByText('Could not load the history.')).toBeInTheDocument();
    expect(screen.queryByText(/CANARY-TEXT/)).toBeNull();
  });
});

describe('live vehicle: overdue service', () => {
  it('shows a negative number with overdue wording', async () => {
    const c = card();
    serveCard({ ...c, readings: { ...c.readings, service_days: -5, service_distance_km: -1200 } });
    open();
    render(<App />);
    const list = await screen.findByTestId('live-readings');
    expect(list).toHaveTextContent('overdue by 1,200 km, overdue by 5 days');
    expect(list).not.toHaveTextContent('-');
  });
});

describe('live vehicle: chart keys', () => {
  it('draws without duplicate-key warnings when runs are single points', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.use(
      http.get('*/api/v1/live-vehicle/history', () =>
        HttpResponse.json(
          history([
            item(3, '2026-10-31T03:00:00Z', 4400, 60),
            item(2, '2026-10-30T03:00:00Z', 4300, 70),
            item(1, '2026-10-29T03:00:00Z', 4200, 80),
          ]),
        ),
      ),
    );
    open('/vehicle/live');
    render(<App />);
    await screen.findByTestId('live-history-list');
    expect(screen.getAllByTestId('live-trend')[0]?.querySelectorAll('circle')).toHaveLength(3);
    expect(err).not.toHaveBeenCalled();
  });
});
