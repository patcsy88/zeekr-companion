import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath } from '../src/api/client';
import { setToken } from '../src/auth/session';
import { keyBytes } from '../src/lib/pushClient';
import {
  openFromNotification,
  parsePush,
  showPush,
  type WindowLike,
  type WorkerScopeLike,
} from '../src/lib/pushHandlers';
import { server } from './server';

const ENDPOINT = 'https://push.example.test/send/abc';

describe('push: request paths', () => {
  it('allows the three push paths and nothing else', () => {
    for (const ok of ['/push/config', '/push/subscriptions', '/push/test'])
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
    for (const bad of [
      '/push',
      '/push/',
      '/push/other',
      '/push/config?x=1',
      '/push/config/x',
      '/push/../vehicle',
    ])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });
});

describe('push: what the service worker shows', () => {
  it('uses the fixed text and the Sentry tab', () => {
    expect(parsePush(JSON.stringify({ body: 'Car is away.', url: '/sentry' }))).toEqual({
      title: 'Zeekr Companion',
      body: 'Car is away.',
      url: '/sentry',
    });
  });

  it.each([
    null,
    '',
    'not json',
    '5',
    'null',
    JSON.stringify({ body: 5, url: 7 }),
    JSON.stringify({ body: '', url: 'https://evil.example.test/' }),
    JSON.stringify({ url: '//evil.example.test' }),
    JSON.stringify({ url: '/sentry/../x' }),
  ])('falls back to safe defaults for %s', (raw) => {
    const v = parsePush(raw);
    expect(v.body.length).toBeGreaterThan(0);
    expect(v.url).toBe('/sentry');
  });

  it('never opens a page outside the allowed list and caps the text', () => {
    expect(parsePush(JSON.stringify({ url: '/geofence' })).url).toBe('/geofence');
    expect(parsePush(JSON.stringify({ body: 'x'.repeat(500) })).body).toHaveLength(200);
  });

  function scopeWith(windows: WindowLike[]) {
    const shown: Array<{ title: string; options: unknown }> = [];
    const opened: string[] = [];
    const scope: WorkerScopeLike = {
      registration: {
        showNotification: (title, options) => {
          shown.push({ title, options });
          return Promise.resolve();
        },
      },
      clients: {
        matchAll: () => Promise.resolve(windows),
        openWindow: (url) => {
          opened.push(url);
          return Promise.resolve(null);
        },
      },
    };
    return { scope, shown, opened };
  }

  it('shows the notification with the page to open', async () => {
    const { scope, shown } = scopeWith([]);
    await showPush(scope, JSON.stringify({ body: 'Hello.', url: '/sentry' }));
    expect(shown).toEqual([
      { title: 'Zeekr Companion', options: { body: 'Hello.', data: { url: '/sentry' } } },
    ]);
  });

  it('a tap opens a new window when the app is not open', async () => {
    const { scope, opened } = scopeWith([{ url: 'https://other.example.test/', focus: vi.fn() }]);
    await openFromNotification(scope, { url: '/sentry' }, 'https://app.example.test');
    expect(opened).toEqual(['/sentry']);
  });

  it('a tap focuses and navigates an open window of the app', async () => {
    const focus = vi.fn(() => Promise.resolve());
    const navigate = vi.fn(() => Promise.resolve());
    const { scope, opened } = scopeWith([
      { url: 'https://app.example.test/geofence', focus, navigate },
    ]);
    await openFromNotification(scope, { url: '/sentry' }, 'https://app.example.test');
    expect(navigate).toHaveBeenCalledWith('/sentry');
    expect(focus).toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it('a tap focuses a window that cannot navigate', async () => {
    const focus = vi.fn(() => Promise.resolve());
    const { scope } = scopeWith([{ url: 'https://app.example.test/', focus }]);
    await openFromNotification(scope, undefined, 'https://app.example.test');
    expect(focus).toHaveBeenCalled();
  });

  it('a tap with a bad page falls back to the Sentry tab', async () => {
    const { scope, opened } = scopeWith([]);
    await openFromNotification(scope, { url: 'https://evil.example.test/' }, 'https://x.test');
    await openFromNotification(scope, 'nope', 'https://x.test');
    expect(opened).toEqual(['/sentry', '/sentry']);
  });
});

describe('push: the key', () => {
  it('turns URL-safe base64 into bytes', () => {
    expect(Array.from(keyBytes('AQID'))).toEqual([1, 2, 3]);
    expect(Array.from(keyBytes('-_8'))).toEqual([251, 255]);
  });
});

// --- the card on the Setup tab ---------------------------------------------------------------

interface FakeSub {
  endpoint: string;
  toJSON: () => { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  unsubscribe: () => Promise<boolean>;
}

function fakeBrowser(opts: {
  permission?: NotificationPermission;
  asked?: NotificationPermission;
  existing?: boolean;
  keys?: boolean;
}) {
  const sub: FakeSub = {
    endpoint: ENDPOINT,
    toJSON: () => ({
      endpoint: ENDPOINT,
      ...(opts.keys === false ? {} : { keys: { p256dh: 'key-1', auth: 'auth-1' } }),
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  let current: FakeSub | null = opts.existing ? sub : null;
  const subscribe = vi.fn(() => {
    current = sub;
    return Promise.resolve(sub);
  });
  const ready = Promise.resolve({
    pushManager: { getSubscription: () => Promise.resolve(current), subscribe },
  });
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready }, configurable: true });
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true });
  const notification = Object.assign(function Notification() {}, {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(() => Promise.resolve(opts.asked ?? 'granted')),
  });
  Object.defineProperty(globalThis, 'Notification', { value: notification, configurable: true });
  return { sub, subscribe, notification };
}

function removeBrowser() {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(globalThis, 'PushManager');
  Reflect.deleteProperty(globalThis, 'Notification');
}

function config(over: Partial<{ enabled: boolean; devices: number }> = {}) {
  return {
    enabled: true,
    public_key: 'AQID',
    devices: 0,
    max_devices: 5,
    ...over,
  };
}

function open(cfg = config()) {
  server.use(http.get('*/api/v1/push/config', () => HttpResponse.json(cfg)));
  window.history.pushState(null, '', '/setup/notifications');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

afterEach(removeBrowser);

async function cardAlert() {
  const card = await screen.findByTestId('push-card');
  return within(card).findByRole('alert');
}

describe('push: the Setup notifications card', () => {
  it('says so when push is not set up on the host', async () => {
    fakeBrowser({});
    open(config({ enabled: false }));
    render(<App />);
    expect(await screen.findByTestId('push-off')).toHaveTextContent('not set up on the host');
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).not.toBeInTheDocument();
  });

  it('explains the Home Screen need when the browser cannot push', async () => {
    removeBrowser();
    open();
    render(<App />);
    expect(await screen.findByTestId('push-unsupported')).toHaveTextContent('Home Screen');
  });

  it('explains a blocked permission and offers no button', async () => {
    fakeBrowser({ permission: 'denied' });
    open();
    render(<App />);
    expect(await screen.findByTestId('push-blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).not.toBeInTheDocument();
  });

  it('turns alerts on from a tap and saves the phone', async () => {
    const posts: unknown[] = [];
    const b = fakeBrowser({});
    const user = open();
    server.use(
      http.post('*/api/v1/push/subscriptions', async ({ request: r }) => {
        posts.push(await r.json());
        return HttpResponse.json({ devices: 1 }, { status: 201 });
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn on alerts' }));
    expect(await screen.findByText('Alerts are on for this phone.')).toBeInTheDocument();
    expect(b.notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(posts).toEqual([{ endpoint: ENDPOINT, keys: { p256dh: 'key-1', auth: 'auth-1' } }]);
    expect(screen.getByTestId('push-devices')).toHaveTextContent('1 of 5');
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('push.example.test');
    expect(document.body.textContent).not.toContain('key-1');
  });

  it('keeps alerts off when the permission is refused', async () => {
    const b = fakeBrowser({ asked: 'denied' });
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn on alerts' }));
    expect(await cardAlert()).toHaveTextContent('Alerts are blocked');
    expect(b.subscribe).not.toHaveBeenCalled();
  });

  it('reports a phone that gives no keys', async () => {
    fakeBrowser({ keys: false });
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn on alerts' }));
    expect(await cardAlert()).toHaveTextContent('did not give an address');
  });

  it('shows the server refusal for a sixth phone', async () => {
    fakeBrowser({});
    const user = open(config({ devices: 5 }));
    server.use(
      http.post('*/api/v1/push/subscriptions', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'Remove one first.', details: [] } },
          { status: 409 },
        ),
      ),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn on alerts' }));
    expect(await cardAlert()).toHaveTextContent('Remove one first.');
    expect(screen.getByRole('button', { name: 'Turn on alerts' })).toBeEnabled();
  });

  it('sends a test and reports the counts', async () => {
    fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 2 }));
    server.use(http.post('*/api/v1/push/test', () => HttpResponse.json({ sent: 2, failed: 0 })));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText('Test sent to 2 phones.')).toBeInTheDocument();
  });

  it('reports a partly failed test', async () => {
    fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 2 }));
    server.use(http.post('*/api/v1/push/test', () => HttpResponse.json({ sent: 1, failed: 1 })));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText('Sent to 1, failed for 1.')).toBeInTheDocument();
  });

  it('says one phone for a single send', async () => {
    fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 1 }));
    server.use(http.post('*/api/v1/push/test', () => HttpResponse.json({ sent: 1, failed: 0 })));
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText('Test sent to 1 phone.')).toBeInTheDocument();
  });

  it('shows the server message when the test is refused', async () => {
    fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 1 }));
    server.use(
      http.post('*/api/v1/push/test', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'Push is not set up on the host.', details: [] } },
          { status: 409 },
        ),
      ),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect(await cardAlert()).toHaveTextContent('not set up on the host');
  });

  it('turns alerts off: the server first, then the browser', async () => {
    const calls: unknown[] = [];
    const b = fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 2 }));
    server.use(
      http.delete('*/api/v1/push/subscriptions', async ({ request: r }) => {
        calls.push(await r.json());
        return HttpResponse.json({ devices: 1 });
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn off alerts' }));
    expect(await screen.findByText('Alerts are off for this phone.')).toBeInTheDocument();
    expect(calls).toEqual([{ endpoint: ENDPOINT }]);
    await waitFor(() => {
      expect(b.sub.unsubscribe).toHaveBeenCalled();
    });
    expect(screen.getByTestId('push-devices')).toHaveTextContent('1 of 5');
    expect(screen.getByRole('button', { name: 'Turn on alerts' })).toBeInTheDocument();
  });

  it('keeps the browser subscription when the server refuses the removal', async () => {
    const b = fakeBrowser({ existing: true, permission: 'granted' });
    const user = open(config({ devices: 1 }));
    server.use(
      http.delete('*/api/v1/push/subscriptions', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'Something went wrong.', details: [] } },
          { status: 500 },
        ),
      ),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Turn off alerts' }));
    expect(await cardAlert()).toBeInTheDocument();
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn off alerts' })).toBeInTheDocument();
  });

  it('shows an error when the settings cannot be loaded', async () => {
    fakeBrowser({});
    const user = open();
    void user;
    server.use(
      http.get('*/api/v1/push/config', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'Something went wrong.', details: [] } },
          { status: 500 },
        ),
      ),
    );
    render(<App />);
    expect(await cardAlert()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).not.toBeInTheDocument();
  });
});
