process.env.TZ = 'Asia/Kuala_Lumpur'; // dates are shown in local time: run as the owner sees them
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { signOut } from '../src/auth/session';
import { resetConnectivityForTests } from '../src/lib/connectivity';
import { closeDbForTests } from '../src/storage/db';
import { resetSyncForTests } from '../src/sync/engine';
import { resetFake, server } from './server';

// Node's fetch needs absolute URLs; the app uses relative ones (same origin).
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/'))
    input = new URL(input, 'http://localhost:3000').toString();
  return realFetch(input, init);
};

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  window.history.replaceState(null, '', '/');
  server.resetHandlers();
  resetFake();
  signOut();
  resetSyncForTests();
  resetConnectivityForTests();
  await closeDbForTests();
});
afterAll(() => {
  server.close();
});
