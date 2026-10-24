import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { request } from '../src/api/client';
import { describeError } from '../src/api/errors';
import { probeApi } from '../src/api/health';
import { setToken } from '../src/auth/session';
import { isOnline, reportReachable } from '../src/lib/connectivity';
import { saveNewRecord } from '../src/data/mutations';
import { err, server } from './server';

const text502 = () =>
  new HttpResponse('502 Bad Gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } });

describe('D2: reachable only after a response that really came from the API', () => {
  it.each([502, 503, 504])('proxy %i counts as unreachable', async (status) => {
    setToken('t', 3600);
    server.use(
      http.get(
        '*/api/v1/vehicle',
        () => new HttpResponse('x', { status, headers: { 'Content-Type': 'text/plain' } }),
      ),
    );
    reportReachable(true);
    await expect(request({ method: 'GET', path: '/vehicle' })).rejects.toMatchObject({
      name: 'NetworkError',
    });
    expect(isOnline()).toBe(false);
  });

  it('a 5xx that still has the contract error shape from the API is an API answer, not a proxy failure', async () => {
    setToken('t', 3600);
    reportReachable(false);
    server.use(
      http.get('*/api/v1/vehicle', () => err(500, 'internal_error', 'Internal server error.')),
    );
    await expect(request({ method: 'GET', path: '/vehicle' })).rejects.toMatchObject({
      status: 500,
    });
    expect(isOnline()).toBe(true);
  });

  it('a non-contract error body (proxy text) does not make us "online"', async () => {
    setToken('t', 3600);
    reportReachable(false);
    server.use(
      http.get(
        '*/api/v1/vehicle',
        () => new HttpResponse('nope', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
      ),
    );
    await expect(request({ method: 'GET', path: '/vehicle' })).rejects.toMatchObject({
      name: 'NetworkError',
    });
    expect(isOnline()).toBe(false);
  });

  it('a 200 that is not JSON (for example an HTML fallback page) does not make us "online"', async () => {
    setToken('t', 3600);
    reportReachable(false);
    server.use(
      http.get(
        '*/api/v1/vehicle',
        () =>
          new HttpResponse('<html></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );
    await expect(request({ method: 'GET', path: '/vehicle' })).rejects.toMatchObject({
      name: 'NetworkError',
    });
    expect(isOnline()).toBe(false);
  });

  it('a contract 401 / 404 from the API makes us online again', async () => {
    reportReachable(false);
    await expect(
      request({ method: 'POST', path: '/auth/token', body: { password: 'x' }, auth: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(isOnline()).toBe(true);
  });

  it('health probe: 502, HTML and network errors are unreachable; {"status":"ok"} is reachable', async () => {
    reportReachable(true);
    server.use(http.get('*/health', text502));
    expect(await probeApi()).toBe(false);
    expect(isOnline()).toBe(false);
    server.use(
      http.get(
        '*/health',
        () => new HttpResponse('<html>', { headers: { 'Content-Type': 'text/html' } }),
      ),
    );
    expect(await probeApi()).toBe(false);
    server.use(http.get('*/health', () => HttpResponse.error()));
    expect(await probeApi()).toBe(false);
    server.use(http.get('*/health', () => HttpResponse.json({ status: 'ok' })));
    expect(await probeApi()).toBe(true);
    expect(isOnline()).toBe(true);
  });
});

describe('D2: the indicator in the UI', () => {
  it('cold start, signed out, browser online, API behind a 502 proxy: "Server unreachable"', async () => {
    server.use(http.get('*/health', text502));
    render(<App />);
    expect(await screen.findByTestId('offline-indicator')).toHaveTextContent('Server unreachable');
  });

  it('cold start, signed out, API fine: no indicator', async () => {
    render(<App />);
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-indicator')).not.toBeInTheDocument();
  });

  it('after a failed sign-in because the proxy answers 502', async () => {
    server.use(
      http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
      http.post('*/api/v1/auth/token', text502),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Online');
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('offline-indicator')).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server is unavailable');
    expect(alert).not.toHaveTextContent('saved on this device'); // nothing was saved by a sign-in
  });

  it('after a failed sign-in with a network error', async () => {
    server.use(http.post('*/api/v1/auth/token', () => HttpResponse.error()));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Online');
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('offline-indicator')).toBeInTheDocument();
  });

  it('when a write is queued while signed out and the API is down', async () => {
    server.use(http.get('*/health', text502));
    await saveNewRecord({
      id: '99999999-9999-4999-8999-999999999999',
      date: '2026-10-01',
      odometer: 1,
      provider: null,
      description: 'Queued',
      cost_minor: 1,
      currency: 'MYR',
      notes: null,
    });
    render(<App />);
    expect(await screen.findByTestId('offline-indicator')).toBeInTheDocument();
    // The queue count is read from IndexedDB asynchronously: wait for it, do not assume it is there.
    expect(await screen.findByTestId('pending-count')).toHaveTextContent('1 waiting to sync');
    expect(
      await screen.findByText(/saved on this device and will sync later/i),
    ).toBeInTheDocument();
  });

  it('signed in, queued write, proxy 503 on POST: indicator shows and the item stays pending', async () => {
    setToken('tok-test', 3600);
    server.use(
      http.post(
        '*/api/v1/service-records',
        () => new HttpResponse('x', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
      ),
    );
    render(<App />);
    await screen.findByText('Online');
    await saveNewRecord({
      id: '98989898-9898-4989-8989-989898989898',
      date: '2026-10-01',
      odometer: 1,
      provider: null,
      description: 'Queued 2',
      cost_minor: 1,
      currency: 'MYR',
      notes: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1 waiting to sync');
  });
});

describe('D3: friendly text', () => {
  it('maps network, proxy and 5xx failures to plain language', async () => {
    setToken('t', 3600);
    server.use(http.get('*/api/v1/vehicle', text502));
    const e1 = await request({ method: 'GET', path: '/vehicle' }).catch((e: unknown) => e);
    expect(describeError(e1)).toBe('The server is unavailable. Try again in a moment.');
    expect(describeError(e1, { saved: true })).toBe(
      'The server is unavailable. Your changes are saved on this device and will sync later.',
    );
    server.use(
      http.get('*/api/v1/vehicle', () => err(500, 'internal_error', 'Internal server error.')),
    );
    const e2 = await request({ method: 'GET', path: '/vehicle' }).catch((e: unknown) => e);
    expect(describeError(e2)).toMatch(/server had a problem/i);
    expect(describeError(e2)).not.toMatch(/internal/i);
  });
});
