import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath } from '../src/api/client';
import type { AutoSentry, CommandLogItem } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { server } from './server';

const CANARY = 'CANARY-SERVER-TEXT-9f3a';

function state(over: Partial<AutoSentry> = {}): AutoSentry {
  return {
    enabled: false,
    quiet_minutes: 60,
    host_allowed: true,
    can_enable: true,
    limits: { quiet_minutes: { min: 5, max: 1440 } },
    ...over,
  };
}

function row(over: Partial<CommandLogItem> = {}): CommandLogItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-11-06T16:00:00Z',
    desired: 'on',
    source: 'auto',
    result: 'sent',
    state_after: 'on',
    skip_reason: null,
    ...over,
  };
}

function serve(initial: AutoSentry, items: CommandLogItem[] = []) {
  const puts: unknown[] = [];
  let current = initial;
  server.use(
    http.get('*/api/v1/vehicle/sentry/auto', () => HttpResponse.json(current)),
    http.put('*/api/v1/vehicle/sentry/auto', async ({ request }) => {
      const body = (await request.json()) as { enabled: boolean; quiet_minutes: number };
      puts.push(body);
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
    http.get('*/api/v1/vehicle/sentry/log', () =>
      HttpResponse.json({ items, retention_months: 12 }),
    ),
  );
  return puts;
}

function open() {
  window.history.pushState(null, '', '/sentry');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

afterEach(async () => {
  // Let the app's start-up sync finish before the shared teardown closes the test database.
  await new Promise((r) => setTimeout(r, 30));
  vi.restoreAllMocks();
  server.events.removeAllListeners();
});

describe('automatic Sentry: request paths', () => {
  it('allows /vehicle/sentry/auto and nothing near it', () => {
    expect(() => {
      assertContractPath('/vehicle/sentry/auto');
    }).not.toThrow();
    for (const bad of [
      '/vehicle/sentry/auto?x=1',
      '/vehicle/sentry/auto/',
      '/vehicle/sentry/auto/x',
      '/vehicle/sentry/autox',
      '/vehicle/sentry/../auto',
    ]) {
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
    }
  });
});

describe('automatic Sentry panel', () => {
  it('is off by default and sends nothing until it is switched', async () => {
    const puts = serve(state());
    open();
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Automatic Sentry on: off' });
    expect(sw).toBeEnabled();
    expect(puts).toEqual([]);
  });

  it('saves the switch with the quiet period', async () => {
    const puts = serve(state({ quiet_minutes: 90 }));
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Automatic Sentry on: off' }));
    await waitFor(() => {
      expect(screen.getByTestId('auto-sentry-note')).toHaveTextContent(
        'Automatic Sentry is on. It sends nothing until a new alert opens.',
      );
    });
    expect(puts).toEqual([{ enabled: true, quiet_minutes: 90 }]);
    expect(screen.getByRole('switch', { name: 'Automatic Sentry on: on' })).toBeInTheDocument();
  });

  it('turns off again', async () => {
    const puts = serve(state({ enabled: true }));
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Automatic Sentry on: on' }));
    await waitFor(() => {
      expect(puts).toEqual([{ enabled: false, quiet_minutes: 60 }]);
    });
    expect(await screen.findByTestId('auto-sentry-note')).toHaveTextContent(
      'Automatic Sentry is off.',
    );
  });

  it('is disabled with a fixed explanation when the server says it cannot be enabled', async () => {
    const puts = serve(state({ can_enable: false, host_allowed: false }));
    open();
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Automatic Sentry on: off' });
    expect(sw).toBeDisabled();
    expect(screen.getByTestId('auto-sentry-blocked')).toHaveTextContent(
      'The host switch, live readings and the geofence must all be on.',
    );
    expect(puts).toEqual([]);
  });

  it('lets an enabled toggle be turned off even if it can no longer be enabled', async () => {
    serve(state({ enabled: true, can_enable: false, host_allowed: false }));
    open();
    render(<App />);
    const sw = await screen.findByRole('switch', { name: 'Automatic Sentry on: on' });
    expect(sw).toBeEnabled();
  });

  it('saves a changed quiet period', async () => {
    const puts = serve(state());
    const user = open();
    render(<App />);
    const input = await screen.findByTestId('auto-sentry-quiet');
    await user.clear(input);
    await user.type(input, '120');
    await user.click(screen.getByTestId('auto-sentry-save'));
    await waitFor(() => {
      expect(puts).toEqual([{ enabled: false, quiet_minutes: 120 }]);
    });
    expect(await screen.findByTestId('auto-sentry-note')).toHaveTextContent('Saved.');
  });

  it.each(['4', '1441', '', '60.5', 'abc', '-5'])('refuses %j without sending it', async (text) => {
    const puts = serve(state());
    const user = open();
    render(<App />);
    const input = await screen.findByTestId('auto-sentry-quiet');
    await user.clear(input);
    if (text) await user.type(input, text);
    expect(screen.getByTestId('auto-sentry-save')).toBeDisabled();
    expect(screen.getByText('Enter a whole number from 5 to 1440.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Automatic Sentry on: off' }));
    expect(puts).toEqual([]);
  });

  it('accepts the two limits', async () => {
    const puts = serve(state());
    const user = open();
    render(<App />);
    const input = await screen.findByTestId('auto-sentry-quiet');
    for (const v of ['5', '1440']) {
      await user.clear(input);
      await user.type(input, v);
      await user.click(screen.getByTestId('auto-sentry-save'));
      await waitFor(() => {
        expect(puts).toHaveLength(v === '5' ? 1 : 2);
      });
    }
    expect(puts).toEqual([
      { enabled: false, quiet_minutes: 5 },
      { enabled: false, quiet_minutes: 1440 },
    ]);
  });

  it('shows fixed wording for a refusal, never the server text', async () => {
    serve(state());
    server.use(
      http.put('*/api/v1/vehicle/sentry/auto', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: CANARY, details: [] } },
          { status: 409 },
        ),
      ),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Automatic Sentry on: off' }));
    const note = await screen.findByTestId('auto-sentry-note');
    expect(note).toHaveTextContent('It cannot be turned on');
    expect(document.body).not.toHaveTextContent(CANARY);
  });

  it('says nothing was changed when the save fails', async () => {
    serve(state());
    server.use(
      http.put('*/api/v1/vehicle/sentry/auto', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: CANARY } }, { status: 500 }),
      ),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('switch', { name: 'Automatic Sentry on: off' }));
    expect(await screen.findByTestId('auto-sentry-note')).toHaveTextContent(
      'Could not save. Nothing was changed.',
    );
    expect(document.body).not.toHaveTextContent(CANARY);
  });

  it('says so when no automatic send has happened', async () => {
    serve(state());
    open();
    render(<App />);
    expect(await screen.findByTestId('auto-sentry-none')).toHaveTextContent(
      'No automatic send yet.',
    );
  });

  it('lists automatic sends and skips in fixed wording, and ignores manual rows', async () => {
    serve(state(), [
      row({
        id: '00000000-0000-4000-8000-000000000002',
        result: 'skipped',
        state_after: null,
        skip_reason: 'quiet_period',
      }),
      row({
        id: '00000000-0000-4000-8000-000000000003',
        result: 'skipped',
        state_after: null,
        skip_reason: 'host_off',
      }),
      row({
        id: '00000000-0000-4000-8000-000000000004',
        result: 'skipped',
        state_after: null,
        skip_reason: 'busy',
      }),
      row({ id: '00000000-0000-4000-8000-000000000005', source: 'manual' }),
      row({ id: '00000000-0000-4000-8000-000000000006', result: 'failed', state_after: null }),
    ]);
    open();
    render(<App />);
    const list = await screen.findByTestId('auto-sentry-log');
    const items = Array.from(list.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('nothing was sent, because a command was sent recently');
    expect(items[1]).toContain('the host switch is off');
    expect(items[2]).toContain('another Sentry command was in progress');
  });

  it.each([
    [{ result: 'sent', state_after: 'on' }, 'The car reports Sentry on.'],
    [{ result: 'sent', state_after: 'off' }, 'the car still reports Sentry off.'],
    [{ result: 'sent', state_after: null }, 'The car has not reported the state.'],
    [{ result: 'refused', state_after: 'on' }, 'The car refused the command'],
    [{ result: 'failed', state_after: null }, 'The command failed'],
  ] as const)('describes %j', async (over, text) => {
    serve(state(), [row(over)]);
    open();
    render(<App />);
    expect(await screen.findByTestId('auto-sentry-log')).toHaveTextContent(text);
  });

  it('shows the time in Kuala Lumpur', async () => {
    serve(state(), [row({ created_at: '2026-11-06T16:30:00Z' })]);
    open();
    render(<App />);
    expect(await screen.findByTestId('auto-sentry-log')).toHaveTextContent(/00:30|12:30 am/i);
  });

  it('stays out of the way when signed out', async () => {
    window.history.pushState(null, '', '/sentry');
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('heading', { name: 'Sentry' })).toBeNull();
    expect(screen.queryByTestId('auto-sentry')).toBeNull();
  });
});
