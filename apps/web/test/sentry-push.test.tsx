import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { assertContractPath } from '../src/api/client';
import type { LiveCard } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { OFF_CARD, server } from './server';

const OBSERVED = '2026-10-31T02:00:00Z';
const enc = new TextEncoder();

function card(sentry: boolean | null): LiveCard {
  const base = OFF_CARD as LiveCard;
  return {
    ...base,
    status: 'ok',
    served_from: 'zeekr',
    observed_at: OBSERVED,
    received_at: OBSERVED,
    readings: {
      ...base.readings,
      indicators: { ...base.readings.indicators, sentry_active: sentry },
    },
  };
}

interface Feed {
  push: (state: 'on' | 'off', at: string) => void;
  end: () => void;
  opens: () => number;
  posts: unknown[];
  auth: string[];
}

function serve(
  sentry: boolean | null,
  held: { state: 'on' | 'off' | null; at: string | null } = { state: null, at: null },
): Feed {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let opens = 0;
  const posts: unknown[] = [];
  const auth: string[] = [];
  server.use(
    http.get('*/api/v1/live-vehicle', () => HttpResponse.json(card(sentry))),
    http.get('*/api/v1/vehicle/sentry/state', () => HttpResponse.json(held)),
    http.post('*/api/v1/vehicle/sentry', async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({});
    }),
    http.get('*/api/v1/vehicle/sentry/events', ({ request }) => {
      opens += 1;
      auth.push(request.headers.get('authorization') ?? '');
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          request.signal.addEventListener('abort', () => {
            try {
              c.close();
            } catch {
              // already closed
            }
          });
        },
      });
      return new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }),
  );
  return {
    push: (state, at) => {
      controller?.enqueue(enc.encode(`event: sentry\ndata: ${JSON.stringify({ state, at })}\n\n`));
    },
    end: () => {
      controller?.close();
    },
    opens: () => opens,
    posts,
    auth,
  };
}

function open() {
  window.history.pushState(null, '', '/vehicle');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  setVisibility('visible');
});

describe('sentry push: request paths', () => {
  it('allows the state and events paths, and nothing near them', () => {
    for (const ok of ['/vehicle/sentry/state', '/vehicle/sentry/events']) {
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
    }
    for (const bad of [
      '/vehicle/sentry/events?x=1',
      '/vehicle/sentry/state?x=1',
      '/vehicle/sentry/events/',
      '/vehicle/sentry/state/x',
      '/vehicle/sentry/eventsx',
    ]) {
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
    }
  });
});

describe('sentry push', () => {
  it('moves the switch when another page changes Sentry, and sends nothing itself', async () => {
    const feed = serve(false);
    open();
    render(<App />);
    expect(await screen.findByRole('switch', { name: 'Sentry: off' })).toBeInTheDocument();
    await waitFor(() => {
      expect(feed.opens()).toBe(1);
    });
    expect(feed.auth).toEqual(['Bearer tok-test']);
    feed.push('on', '2026-10-31T03:00:00Z');
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
    expect(screen.getByTestId('sentry-seen')).toHaveTextContent('Sentry: on, read from the car at');
    expect(feed.posts).toEqual([]);
  });

  it('ignores a pushed state that is older than the card reading', async () => {
    const feed = serve(true);
    open();
    render(<App />);
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
    await waitFor(() => {
      expect(feed.opens()).toBe(1);
    });
    feed.push('off', '2026-10-31T01:00:00Z');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
    expect(screen.queryByTestId('sentry-seen')).not.toBeInTheDocument();
  });

  it('takes the held state when the page loads', async () => {
    serve(false, { state: 'on', at: '2026-10-31T03:30:00Z' });
    open();
    render(<App />);
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
  });

  it('re-syncs from the held state when the page becomes visible again', async () => {
    const feed = serve(false);
    open();
    render(<App />);
    await screen.findByRole('switch', { name: 'Sentry: off' });
    await waitFor(() => {
      expect(feed.opens()).toBe(1);
    });
    setVisibility('hidden');
    server.use(
      http.get('*/api/v1/vehicle/sentry/state', () =>
        HttpResponse.json({ state: 'on', at: '2026-10-31T04:00:00Z' }),
      ),
    );
    setVisibility('visible');
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
    await waitFor(() => {
      expect(feed.opens()).toBe(2);
    });
  });

  it('opens no stream while the page is hidden', async () => {
    setVisibility('hidden');
    const feed = serve(false);
    open();
    render(<App />);
    await screen.findByText('Live from the car');
    await new Promise((r) => setTimeout(r, 100));
    expect(feed.opens()).toBe(0);
  });

  it('reconnects after the stream ends and picks up later pushes', async () => {
    const feed = serve(false);
    open();
    render(<App />);
    await screen.findByRole('switch', { name: 'Sentry: off' });
    await waitFor(() => {
      expect(feed.opens()).toBe(1);
    });
    feed.end();
    await waitFor(
      () => {
        expect(feed.opens()).toBe(2);
      },
      { timeout: 6000 },
    );
    feed.push('on', '2026-10-31T05:00:00Z');
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
  });

  it('shows the switch as unchanged when the stream is refused', async () => {
    serve(false);
    server.use(
      http.get('*/api/v1/vehicle/sentry/events', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'x', details: [] } },
          { status: 429 },
        ),
      ),
    );
    open();
    render(<App />);
    expect(await screen.findByRole('switch', { name: 'Sentry: off' })).toBeInTheDocument();
  });
});
