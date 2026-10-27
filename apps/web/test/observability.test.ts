import * as Sentry from '@sentry/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/browser', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  init: vi.fn(),
}));
import { initSentry, scrubEvent } from '../src/lib/observability';

const SECRETS = ['hunter2-password', 'Bearer abc.def.ghi', 'owner-test', '12345.67', 'WXY1234'];

function event(): Sentry.ErrorEvent {
  return {
    event_id: 'e1',
    level: 'error',
    platform: 'javascript',
    user: { username: 'owner-test', ip_address: '10.0.0.5' },
    extra: { amount: '12345.67' },
    tags: { plate: 'WXY1234' },
    breadcrumbs: [{ message: 'typed hunter2-password' }],
    request: {
      url: 'https://app.example/expenses?note=WXY1234#Bearer abc.def.ghi',
      headers: { Authorization: 'Bearer abc.def.ghi' },
      cookies: { s: 'x' },
    },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'cannot read owner-test 12345.67',
          stacktrace: {
            frames: [
              {
                filename: 'https://app.example/assets/index-1.js?note=WXY1234',
                function: 'f',
                lineno: 3,
                colno: 9,
                vars: { password: 'hunter2-password' },
              },
            ],
          },
        },
      ],
    },
  } as unknown as Sentry.ErrorEvent;
}

afterEach(() => vi.mocked(Sentry.init).mockClear());

describe('scrubEvent', () => {
  it('removes every secret', () => {
    const out = JSON.stringify(scrubEvent(event()));
    for (const s of [...SECRETS, '10.0.0.5']) expect(out).not.toContain(s);
  });
  it('keeps what is needed to debug', () => {
    const out = scrubEvent(event()) as unknown as {
      request: { url: string };
      exception: { values: { type: string; value?: string; stacktrace: { frames: unknown[] } }[] };
    };
    expect(out.request).toEqual({ url: '/expenses' });
    const first = out.exception.values[0];
    expect(first?.type).toBe('TypeError');
    expect(first?.value).toBeUndefined();
    expect(first?.stacktrace.frames[0]).toEqual({
      filename: '/assets/index-1.js',
      function: 'f',
      lineno: 3,
      colno: 9,
    });
  });
});

describe('initSentry', () => {
  it('does nothing without a DSN', () => {
    const init = vi.mocked(Sentry.init);
    expect(initSentry(undefined)).toBe(false);
    expect(initSentry('')).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
  it('uses privacy-safe options', () => {
    const init = vi.mocked(Sentry.init);
    expect(initSentry('https://key@o0.ingest.example.invalid/1', 'r1')).toBe(true);
    const opts = init.mock.calls[0]?.[0];
    expect(opts?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    expect(opts?.tracesSampleRate).toBe(0);
    expect(opts?.maxBreadcrumbs).toBe(0);
    expect(opts?.defaultIntegrations).toBe(false);
    expect(opts?.beforeSend).toBe(scrubEvent);
  });
});
