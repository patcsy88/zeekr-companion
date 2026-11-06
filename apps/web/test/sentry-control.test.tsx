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
  window.history.pushState(null, '', '/sentry');
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
    const button = await screen.findByRole('switch', { name: 'Sentry: off' });
    await user.click(button);
    expect(screen.getByRole('group', { name: 'Confirm Sentry command' })).toHaveTextContent(
      'sends a real command to the car: Sentry on',
    );
    expect(posts).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('switch', { name: 'Sentry: off' })).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('offers "off" when the car reports on', async () => {
    serve(true);
    open();
    render(<App />);
    expect(await screen.findByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
  });

  it('sends once after confirming and shows what the car reported', async () => {
    const posts = serve(false);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    await waitFor(() => {
      expect(screen.getByTestId('sentry-result')).toHaveTextContent('The car reports Sentry on.');
    });
    expect(posts).toEqual([{ desired: 'on' }]);
  });

  it('clears the result line when Refresh loads a new reading', async () => {
    serve(false);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    await screen.findByTestId('sentry-result');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(screen.queryByTestId('sentry-result')).toBeNull();
    });
  });

  it('does not claim success when the car has not reported the change', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: 'off', confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
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
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    expect(await screen.findByTestId('sentry-result')).toHaveTextContent(
      'has not reported the state, so the switch is unchanged',
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
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    const result = await screen.findByTestId('sentry-result');
    expect(result).toHaveTextContent(wording);
    expect(document.body).not.toHaveTextContent(CANARY);
  });

  it('an unreachable server says to check the car before trying again', async () => {
    serve(false, () => HttpResponse.error());
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
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
    expect(screen.queryByTestId('sentry-switch')).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    const send = screen.getByRole('button', { name: 'Send Sentry on' });
    await user.dblClick(send);
    expect(await screen.findByTestId('sentry-sending')).toBeInTheDocument();
    release();
    await screen.findByTestId('sentry-result');
    expect(posts).toHaveLength(1);
  });

  it('after a send, the page shows what the car reported and offers the next action from it', async () => {
    serve(false);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    const seen = await screen.findByTestId('sentry-seen');
    expect(seen).toHaveTextContent('Sentry: on, read from the car at');
    expect(seen).not.toHaveTextContent('readings above');
    expect(screen.getByRole('switch', { name: 'Sentry: on' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sentry: off' })).not.toBeInTheDocument();
  });

  it('keeps the reported state even when the car had not yet shown the change', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: 'off', confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    expect(await screen.findByTestId('sentry-seen')).toHaveTextContent('Sentry: off');
    expect(screen.getByRole('switch', { name: 'Sentry: off' })).toBeInTheDocument();
  });

  it('shows no read-from-the-car line when the state after is unknown or the send failed', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: null, confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    await screen.findByTestId('sentry-result');
    expect(screen.queryByTestId('sentry-seen')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sentry: off' })).toBeInTheDocument();
  });

  it('the Vehicle page has no Sentry control, and the indicator list does not mention Sentry', async () => {
    serve(true);
    window.history.pushState(null, '', '/vehicle');
    setToken('tok-test', 3600);
    render(<App />);
    const list = await screen.findByTestId('live-indicators');
    expect(list).not.toHaveTextContent('Sentry');
    expect(screen.queryByRole('switch', { name: /^Sentry/ })).toBeNull();
    expect(screen.queryByTestId('sentry-switch')).toBeNull();
  });

  it('the Sentry tab holds the control', async () => {
    serve(true);
    open();
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Sentry: on' });
    expect(sw).not.toHaveAttribute('aria-readonly');
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('flipping the switch sends nothing until Send is pressed, and the switch does not move', async () => {
    const posts = serve(false);
    const user = open();
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Sentry: off' });
    await user.click(sw);
    expect(posts).toEqual([]);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(screen.queryByRole('group', { name: 'Confirm Sentry command' })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('the switch follows the state the API returns, not the one that was asked for', async () => {
    serve(false, () =>
      HttpResponse.json({ desired: 'on', sent: true, state_after: 'off', confirmed: false }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    const result = await screen.findByTestId('sentry-result');
    expect(result).toHaveTextContent('did not take effect');
    expect(result).toHaveTextContent('still reports Sentry off');
    expect(screen.getByRole('switch', { name: 'Sentry: off' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('the switch moves to on when the API confirms it, and is disabled while sending', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve(false, async () => {
      await gate;
      return HttpResponse.json({ desired: 'on', sent: true, state_after: 'on', confirmed: true });
    });
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: off' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry on' }));
    expect(await screen.findByTestId('sentry-sending')).toBeInTheDocument();
    expect(screen.getByTestId('sentry-switch')).toBeDisabled();
    release();
    const sw = await screen.findByRole('switch', { name: 'Sentry: on' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('sentry-result')).toHaveTextContent('The car reports Sentry on.');
  });

  it('a refused send leaves the switch where the car last reported it', async () => {
    serve(true, () =>
      HttpResponse.json(
        { error: { code: 'upstream_error', message: CANARY, details: [] } },
        { status: 502 },
      ),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Sentry: on' }));
    await user.click(screen.getByRole('button', { name: 'Send Sentry off' }));
    expect(await screen.findByTestId('sentry-result')).toHaveTextContent('did not accept');
    expect(screen.getByRole('switch', { name: 'Sentry: on' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('the read-only indicators still send nothing when clicked', async () => {
    const posts = serve(true);
    window.history.pushState(null, '', '/vehicle');
    setToken('tok-test', 3600);
    render(<App />);
    await screen.findByTestId('live-indicators');
    await userEvent.click(screen.getByRole('switch', { name: /^Fragrance:/ }));
    expect(posts).toEqual([]);
  });
});
