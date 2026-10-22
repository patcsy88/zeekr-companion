import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setToken, getSession } from '../src/auth/session';
import { RecordForm } from '../src/components/RecordForm';
import { reportReachable } from '../src/lib/connectivity';
import { enqueueCreate, listQueue } from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { err, fake, server } from './server';

afterEach(() => {
  vi.useRealTimers();
});

const mk = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  date: '2026-09-01',
  odometer: 10,
  provider: null,
  description: 'Seed',
  cost_minor: 100,
  currency: 'MYR',
  notes: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

/** First row of the records list (the sync bar's status badges are list items too). */
async function firstRow(): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: /Service records/ });
  return within(list).getAllByRole('listitem')[0] as HTMLElement;
}

type User = ReturnType<typeof userEvent.setup>;

async function fillAndSave(user: User, o: { desc?: string; date?: string } = {}) {
  if (o.date) {
    await user.clear(screen.getByLabelText('Date'));
    await user.type(screen.getByLabelText('Date'), o.date);
  }
  await user.type(screen.getByLabelText('Odometer (km)'), '100');
  await user.type(screen.getByLabelText('Description'), o.desc ?? 'Thing');
  await user.type(screen.getByLabelText('Cost (MYR)'), '1');
}

const signInWith429 = (retryAfter?: string) =>
  server.use(
    http.post('*/api/v1/auth/token', () =>
      err(429, 'rate_limited', 'x', [], retryAfter ? { 'Retry-After': retryAfter } : undefined),
    ),
  );

describe('429 in the sign-in UI', () => {
  it('shows minutes from Retry-After and keeps the form usable', async () => {
    signInWith429('899');
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Too many attempts. Try again in 15 minutes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('says "1 minute" in the singular and copes with a missing header', async () => {
    signInWith429('30');
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Too many attempts. Try again in 1 minute.'),
    ).toBeInTheDocument();
    signInWith429();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too many attempts. Try again later.')).toBeInTheDocument();
  });
});

describe('Asia/Kuala_Lumpur future-date rule (owner decision 2026-10-22)', () => {
  it('00:00-08:00 Malaysian time: the Malaysian date is accepted, no UTC window', async () => {
    // 2026-10-11 17:30 UTC is 2026-10-12 01:30 in Malaysia (UTC+8).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T17:30:00Z'));
    fake.klDateRule = true;
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-12');
    await fillAndSave(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.records.size).toBe(1);
    });
    expect([...fake.records.values()][0]?.date).toBe('2026-10-12');
  });

  it('a date after the Malaysian today is refused and shown as failed without a UTC explanation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T17:30:00Z'));
    fake.klDateRule = true;
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await fillAndSave(user, { date: '2026-10-13' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const row = await firstRow();
    await waitFor(() => {
      expect(within(row).getByTestId('sync-failed')).toBeInTheDocument();
    });
    await user.click(within(row).getByRole('link'));
    expect(await screen.findByText(/date: must not be in the future/)).toBeInTheDocument();
    expect(screen.queryByText(/UTC|Between 00:00/)).not.toBeInTheDocument();
    expect(fake.records.size).toBe(0);
  });

  it('the edit form shows the server date issue next to the field', () => {
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => Promise.resolve()}
        serverIssues={{ date: 'must not be in the future' }}
      />,
    );
    expect(screen.getByLabelText('Date')).toHaveAccessibleDescription(/must not be in the future/);
    expect(document.getElementById('date-explain')).toBeNull();
  });
});

describe('401 in the middle of the queue', () => {
  const ids = [
    'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
    'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
    'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3',
  ];

  it('first item is sent, then 401 pauses; the rest stay pending and resume after sign-in', async () => {
    setToken('tok-test', 3600);
    for (const id of ids)
      await enqueueCreate({
        id,
        date: '2026-09-01',
        odometer: 1,
        description: id.slice(0, 2),
        cost_minor: 1,
        currency: 'MYR',
      });
    let n = 0;
    server.use(
      http.post('*/api/v1/service-records', async ({ request }) => {
        const b = (await request.json()) as { id: string };
        n += 1;
        if (n === 2) return err(401, 'unauthenticated', 'expired');
        fake.posts.push(b);
        fake.records.set(b.id, mk(b.id));
        return HttpResponse.json(mk(b.id), { status: 201 });
      }),
    );
    await flush(true);
    expect(getSession()).toEqual({ signedIn: false, needsLogin: true });
    expect((await listQueue()).map((e) => e.status)).toEqual(['pending', 'pending']);
    expect(fake.records.size).toBe(1);
    n = 10; // the server is happy again
    setToken('tok-2', 3600);
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
    expect(fake.records.size).toBe(3);
  });

  it('the UI asks for the password and says the changes are safe', async () => {
    setToken('tok-test', 3600);
    server.use(http.post('*/api/v1/service-records', () => err(401, 'unauthenticated', 'x')));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await fillAndSave(user, { date: '2026-09-01' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(await screen.findByTestId('pending-count')).toHaveTextContent('1 waiting to sync');
  });
});

describe('400 / 409 on a queued item are shown to the user', () => {
  it.each([
    [
      400,
      'validation_error',
      'Request failed validation.',
      [{ field: 'odometer', issue: 'must be <= 10000000' }],
      /odometer: must be <= 10000000/,
    ],
    [
      409,
      'conflict',
      'A service record with this id already exists with different content.',
      [],
      /already exists with different content/,
    ],
  ])('%i', async (status, code, message, details, expected) => {
    setToken('tok-test', 3600);
    server.use(http.post('*/api/v1/service-records', () => err(status, code, message, details)));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await fillAndSave(user, { date: '2026-09-01', desc: 'Refused' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const row = await firstRow();
    expect(await within(row).findByTestId('sync-failed')).toBeInTheDocument();
    expect(screen.getByTestId('failed-count')).toHaveTextContent('1 failed');
    await user.click(within(row).getByRole('link'));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard my change' })).toBeInTheDocument();
  });
});

describe('double submit and duplicate taps create one record', () => {
  it('double-clicking Save sends one POST and creates one record', async () => {
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await fillAndSave(user, { date: '2026-09-01', desc: 'Once' });
    await user.dblClick(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.records.size).toBe(1);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.posts).toHaveLength(1);
    expect(await listQueue()).toHaveLength(0);
    expect(
      within(screen.getByRole('list', { name: /Service records/ })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('three rapid taps on Save while offline queue exactly one create', async () => {
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    reportReachable(false);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await fillAndSave(user, { date: '2026-09-01', desc: 'Offline once' });
    await user.tripleClick(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      expect(await listQueue()).toHaveLength(1);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(await listQueue()).toHaveLength(1);
  });
});

describe('contract bounds in the form', () => {
  async function submit(odo: string, cost: string) {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<RecordForm submitLabel="Save" onCancel={() => undefined} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Odometer (km)'), odo);
    await user.type(screen.getByLabelText('Description'), 'x');
    await user.type(screen.getByLabelText('Cost (MYR)'), cost);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    return onSubmit;
  }

  it('accepts odometer 0 and cost 0', async () => {
    expect(await submit('0', '0')).toHaveBeenCalledWith(
      expect.objectContaining({ odometer: 0, cost_minor: 0 }),
    );
  });

  it('accepts the upper bounds exactly (10,000,000 km; 10^12 sen)', async () => {
    expect(await submit('10000000', '10000000000.00')).toHaveBeenCalledWith(
      expect.objectContaining({ odometer: 10_000_000, cost_minor: 1_000_000_000_000 }),
    );
  });

  it.each([
    ['10000001', '1', 'Odometer (km)'],
    ['-1', '1', 'Odometer (km)'],
    ['1.5', '1', 'Odometer (km)'],
    ['1e3', '1', 'Odometer (km)'],
    ['5', '10000000000.01', 'Cost (MYR)'],
    ['5', '-1', 'Cost (MYR)'],
    ['5', '1.005', 'Cost (MYR)'],
    ['5', 'abc', 'Cost (MYR)'],
  ])('rejects odometer %s / cost %s before anything is sent', async (odo, cost, label) => {
    const onSubmit = await submit(odo, cost);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('XSS strings are rendered as text', () => {
  const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  it('in the list, the detail view and the edit form', async () => {
    const w = window as unknown as { __xss?: number };
    w.__xss = undefined;
    const id = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    fake.records.set(id, mk(id, { description: payload, provider: payload, notes: payload }));
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    const { container } = render(<App />);
    const link = await screen.findByRole('link', { name: new RegExp(payload.slice(0, 12)) });
    expect(link).toHaveTextContent(payload);
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(payload);
    expect(container.querySelector('img, script')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Edit' }));
    expect(await screen.findByLabelText('Description')).toHaveValue(payload);
    expect(container.querySelector('img, script')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(w.__xss).toBeUndefined();
  });
});
