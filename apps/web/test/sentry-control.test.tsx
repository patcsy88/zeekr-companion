import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath, request } from '../src/api/client';
import type { LiveCard } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { OFF_CARD, server } from './server';

const OBSERVED = '2026-10-31T02:00:00Z';
const CANARY = 'CANARY-SERVER-TEXT-9f3a';

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

function open() {
  window.history.pushState(null, '', '/vehicle');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

function serve(sentry: boolean | null, post?: () => Response | Promise<Response>) {
  const posts: unknown[] = [];
  server.use(
    http.get('*/api/v1/live-vehicle', () => HttpResponse.json(card(sentry))),
    http.post('*/api/v1/vehicle/sentry', async ({ request: r }) => {
      posts.push(await r.json());
      return post
        ? post()
        : HttpResponse.json({ desired: 'on', sent: true, state_after: 'on', confirmed: true });
    }),
  );
  return posts;
}

afterEach(() => {
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});

describe('sentry control: request paths', () => {
  it('allows only the two Sentry paths', () => {
    for (const ok of ['/vehicle/sentry', '/vehicle/sentry/log', '/vehicle/sentry/log?limit=5']) {
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
    }
    for (const bad of [
      '/vehicle/sentry/',
      '/vehicle/sentry?x=1',
      '/vehicle/sentry/log/x',
      '/vehicle/sentry/other',
      '/vehicle/sentry/log?a=b?c',
      '/vehicle/sentry/log?x=/y',
      '/vehicle/sentry/../x',
      '/vehicle/sentryx',
    ]) {
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
    }
  });

  it('refuses a bad path without calling fetch', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(request({ method: 'POST', path: '/vehicle/sentry/x' })).rejects.toMatchObject({
      name: 'ClientError',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sentry control', () => {
  it('offers the opposite of what the car reports, and sends nothing until confirmed', async () => {
    const posts = serve(false);
    const user = open();
    render(<App />);
    const button = await screen.findByRole('button', { name: 'Turn Sentry on' });
    await user.click(button);
    expect(screen.getByRole('group', { name: 'Confirm Sentry command' })).toHaveTextContent(
      'sends a real command to the car: Sentry on',
    );
    expect(posts).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Turn Sentry on' })).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('offers "off" when the car reports on', async () => {
    serve(true);
    open();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Turn Sentry off' })).toBeInTheDocument();
  });

  it('sends once after confirming and shows what the car reported', async () => {
    const posts = serve(false);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    await waitFor(() => {
      expect(screen.getByTestId('sentry-result')).toHaveTextContent('The car reports Sentry on.');
    });
    expect(posts).toEqual([{ desired: 'on' }]);
  });

  it('does not claim success when the car has not reported the change', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: 'off', confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    const result = await screen.findByTestId('sentry-result');
    expect(result).toHaveTextContent('still reports Sentry off');
    expect(result).not.toHaveTextContent('The car reports Sentry on');
  });

  it('says so when the state after is unknown', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: null, confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    expect(await screen.findByTestId('sentry-result')).toHaveTextContent(
      'has not reported the state yet',
    );
  });

  it.each([
    [409, 'conflict', 'already in progress'],
    [502, 'upstream_error', 'did not accept the command'],
    [404, 'not_found', 'Live vehicle readings are off'],
  ])('a %i shows fixed wording and never the server text', async (status, code, wording) => {
    serve(false, () =>
      HttpResponse.json({ error: { code, message: CANARY, details: [] } }, { status }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    const result = await screen.findByTestId('sentry-result');
    expect(result).toHaveTextContent(wording);
    expect(document.body).not.toHaveTextContent(CANARY);
  });

  it('an unreachable server says to check the car before trying again', async () => {
    serve(false, () => HttpResponse.error());
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    expect(await screen.findByTestId('sentry-result')).toHaveTextContent(
      'Check the car before trying again',
    );
  });

  it('shows no button when the car has not reported Sentry', async () => {
    const posts = serve(null);
    open();
    render(<App />);
    expect(await screen.findByTestId('sentry-unknown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn Sentry/ })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('a double click on Send sends one command', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts = serve(false, async () => {
      await gate;
      return HttpResponse.json({ desired: 'on', sent: true, state_after: 'on', confirmed: true });
    });
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn Sentry on' }));
    const send = screen.getByRole('button', { name: 'Send Sentry on' });
    await user.dblClick(send);
    expect(await screen.findByTestId('sentry-sending')).toBeInTheDocument();
    release();
    await screen.findByTestId('sentry-result');
    expect(posts).toHaveLength(1);
  });

  it('the read-only indicators still send nothing when clicked', async () => {
    const posts = serve(true);
    open();
    render(<App />);
    await screen.findByTestId('live-indicators');
    await userEvent.click(screen.getByRole('switch', { name: 'Sentry: on' }));
    expect(posts).toEqual([]);
  });
});
