import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { expire, setToken } from '../src/auth/session';
import { enqueueCreate } from '../src/storage/queue';
import { server } from './server';

// Owner decision 2026-11-07: signed out, only the sign-in form is shown. Saved data stays on the
// device (unsent changes are kept) but no page, tab or record is on screen.
const rec = {
  id: '14141414-1414-4414-8414-141414141414',
  date: '2026-10-01',
  odometer: 1,
  provider: null,
  description: 'Hidden-when-signed-out',
  cost_minor: 1,
  currency: 'MYR' as const,
  notes: null,
};

const apiDown = () => server.use(http.post('*/api/v1/service-records', () => HttpResponse.error()));

describe('signed out: nothing but the sign-in form', () => {
  it.each(['/', '/reminders', '/expenses', '/warranty', '/sentry', '/geofence', '/vehicle'])(
    '%s shows the sign-in form, no tabs and no saved data',
    async (path) => {
      apiDown();
      await enqueueCreate(rec);
      window.history.pushState(null, '', path);
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(screen.queryByText(/Hidden-when-signed-out/)).toBeNull();
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
        'Sign in',
      ]);
    },
  );

  it('shows the data after sign in, and hides it again when the session ends', async () => {
    apiDown();
    await enqueueCreate(rec);
    window.history.pushState(null, '', '/');
    setToken('tok-test', 3600);
    render(<App />);
    expect(await screen.findByText(/Hidden-when-signed-out/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expire();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your session ended/)).toBeInTheDocument();
    expect(screen.queryByText(/Hidden-when-signed-out/)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});
