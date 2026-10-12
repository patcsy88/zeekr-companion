import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { getSession, setToken } from '../src/auth/session';
import { getDb } from '../src/storage/db';
import { setCache, setMeta } from '../src/storage/cache';
import { enqueueCreate } from '../src/storage/queue';
import { server } from './server';

// Unsent changes must stay unsent for these tests: the API is unreachable.
const apiDown = () => server.use(http.post('*/api/v1/service-records', () => HttpResponse.error()));

const rec = {
  id: '13131313-1313-4313-8313-131313131313',
  date: '2026-10-01',
  odometer: 1,
  provider: null,
  description: 'Unsent',
  cost_minor: 1,
  currency: 'MYR' as const,
  notes: null,
};
async function counts() {
  const db = await getDb();
  return {
    cache: await db.count('cache'),
    queue: await db.count('queue'),
    meta: await db.count('meta'),
  };
}

describe('W2: sign out versus clear local data', () => {
  it('plain sign out says it keeps local data, and keeps the cache and queue', async () => {
    apiDown();
    setToken('tok-test', 3600);
    await setCache('k', 1);
    await enqueueCreate(rec);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign out, keep local data' }));
    expect(getSession().signedIn).toBe(false);
    expect(await counts()).toMatchObject({ cache: expect.any(Number) as number, queue: 1 });
    expect((await counts()).cache).toBeGreaterThan(0);
  });

  it('clear-and-sign-out warns about unsent changes and clears nothing until confirmed', async () => {
    apiDown();
    setToken('tok-test', 3600);
    await setCache('k', 1);
    await setMeta('m', 1);
    await enqueueCreate(rec);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign out and clear local data' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1 change/i);
    expect(dialog).toHaveTextContent(/not reached the server/i);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(getSession().signedIn).toBe(true);
    expect((await counts()).queue).toBe(1);
  });

  it('confirming clears cache, queue and meta and signs out', async () => {
    apiDown();
    setToken('tok-test', 3600);
    await setCache('k', 1);
    await setMeta('m', 1);
    await enqueueCreate(rec);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign out and clear local data' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Clear local data and sign out',
      }),
    );
    await waitFor(async () => {
      expect(await counts()).toEqual({ cache: 0, queue: 0, meta: 0 });
    });
    expect(getSession().signedIn).toBe(false);
    expect(screen.queryByText('Unsent')).not.toBeInTheDocument();
  });

  it('with nothing unsent there is no data-loss warning', async () => {
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Online');
    await user.click(screen.getByRole('button', { name: 'Sign out and clear local data' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).not.toHaveTextContent(/not reached the server/i);
  });
});
