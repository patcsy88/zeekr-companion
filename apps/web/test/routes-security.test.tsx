import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { request } from '../src/api/client';
import { getServiceRecord, deleteServiceRecord, patchServiceRecord } from '../src/api/endpoints';
import { setToken } from '../src/auth/session';
import { isUuid } from '../src/lib/uuid';

/**
 * API calls that could come from the crafted id. The app's own start-up sync (GET /vehicle and
 * the list) is expected and is not matched: only traversal/encoded text or a single-record path.
 */
const apiCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/api/'))
    .filter((u) => /\.\.|%|\/service-records\/|\/records\//i.test(u));

describe('W3: route and request ids', () => {
  it('isUuid accepts v4 UUIDs only', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
    for (const bad of [
      '',
      '../vehicle',
      'new',
      '1111',
      '11111111-1111-4111-8111-11111111111g',
      '11111111-1111-4111-8111-111111111111/../x',
    ])
      expect(isUuid(bad)).toBe(false);
  });

  it.each([
    '/records/..%2Fvehicle',
    '/records/..%2Fvehicle/edit',
    '/records/%2e%2e%2fvehicle',
    '/records/not-a-uuid',
  ])('crafted route %s shows not found and makes no API call', async (path) => {
    setToken('tok-test', 3600);
    window.history.replaceState(null, '', path);
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    console.log('CALLS', JSON.stringify(apiCalls(spy).map((c) => c[0])));
    expect(apiCalls(spy)).toEqual([]);
  });

  it('request() refuses paths outside the contract without calling fetch', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const path of [
      '/service-records/../vehicle',
      '/service-records/..%2Fvehicle',
      '/vehicle/../x',
      '//evil.example/x',
      'service-records',
      '/other',
      '/service-records/abc',
    ])
      await expect(request({ method: 'GET', path })).rejects.toMatchObject({ name: 'ClientError' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('endpoint helpers reject non-UUID ids before any request', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(getServiceRecord('../vehicle')).rejects.toBeTruthy();
    await expect(deleteServiceRecord('../vehicle')).rejects.toBeTruthy();
    await expect(patchServiceRecord('a/b', {})).rejects.toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});
