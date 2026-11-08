import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { TyreEvent } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { validateTyreEvent } from '../src/components/TyreEventForm';
import { reportReachable } from '../src/lib/connectivity';
import { setCache } from '../src/storage/cache';
import { closeDbForTests } from '../src/storage/db';
import { listQueue } from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { fake, server } from './server';

const STAMP = '2026-10-01T00:00:00Z';
const ALL = ['driver_front', 'passenger_front', 'driver_rear', 'passenger_rear'] as const;
const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function ev(n: number, over: Partial<TyreEvent> = {}): TyreEvent {
  return {
    id: id(n),
    date: '2026-09-01',
    kind: 'replace',
    wheels: [...ALL],
    odometer: 10000,
    brand: 'Brand A',
    model: 'Model B',
    size: '255/45 R20',
    cost_minor: null,
    currency: 'MYR',
    shop: null,
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
const rot = (n: number, over: Partial<TyreEvent> = {}) =>
  ev(n, { kind: 'rotate', brand: null, model: null, size: null, ...over });
function seed(...items: TyreEvent[]) {
  for (const x of items) fake.tyreEvents.set(x.id, x);
}
function seedRecord(odometer: number) {
  const rid = 'b0000000-0000-4000-8000-000000000001';
  fake.records.set(rid, {
    id: rid,
    date: '2026-09-01',
    odometer,
    provider: null,
    description: 'Seed',
    cost_minor: 100,
    currency: 'MYR',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
  });
}
function seedVehicle(tyre_spec: string | null) {
  fake.vehicle = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    model: '7X',
    variant: '',
    drive: 'AWD',
    steering: 'RHD',
    registration: null,
    vin: null,
    purchase_date: null,
    purchase_price_minor: 0,
    currency: 'MYR',
    tyre_spec,
  };
}
function open(path = '/vehicle/tyres') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}
/** Waits for the app-start sync (which fetches tyre events) to finish. */
async function started() {
  await waitFor(() => {
    expect(fake.tyreGets).toBeGreaterThan(0);
    expect(fake.templateGets).toBeGreaterThan(0); // the last request of the app-start sync
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const list = () => screen.findByRole('list', { name: 'Tyre events, newest first' });

describe('AC-79 / AC-80: list and Current tyres', () => {
  it('lists events newest first with type, wheels, odometer and cost', async () => {
    seed(
      ev(1, { date: '2026-01-01', cost_minor: 120000 }),
      rot(2, { date: '2026-05-01', wheels: ['driver_front', 'driver_rear'], odometer: 15000 }),
    );
    open();
    render(<App />);
    const items = within(await list()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Rotate · Driver front, Driver rear');
    expect(items[0]).toHaveTextContent('15,000 km');
    expect(items[1]).toHaveTextContent('Replace · All four');
    expect(items[1]).toHaveTextContent('RM 1,200.00');
  });

  it('shows Current tyres per wheel with km since, from the current odometer', async () => {
    seedRecord(12000);
    seed(
      ev(1, { date: '2025-01-01', odometer: 2000, brand: 'Old' }),
      ev(2, { date: '2026-02-01', odometer: 9000, brand: 'New', wheels: ['driver_front'] }),
      rot(3, { date: '2026-03-01', odometer: 11000 }),
    );
    open();
    render(<App />);
    const df = await screen.findByTestId('wheel-driver_front');
    await waitFor(() => {
      expect(df).toHaveTextContent('3,000 km ago');
    });
    expect(df).toHaveTextContent('New Model B 255/45 R20');
    expect(df).toHaveTextContent('Last rotated');
    expect(df).toHaveTextContent('1,000 km ago');
    const pr = screen.getByTestId('wheel-passenger_rear');
    expect(pr).toHaveTextContent('Old');
    expect(pr).toHaveTextContent('10,000 km ago');
  });

  it('says No replacement recorded when there are no events', async () => {
    open();
    render(<App />);
    expect(await screen.findByText('No tyre events yet.')).toBeInTheDocument();
    for (const w of ALL)
      expect(screen.getByTestId(`wheel-${w}`)).toHaveTextContent('No replacement recorded.');
  });

  it('AC-82: says tyre costs are not included in Expenses', async () => {
    open();
    render(<App />);
    expect(await screen.findByTestId('not-in-expenses')).toHaveTextContent(
      'Tyre costs are not included in Expenses',
    );
  });

  it('fetches every page, so a multi-page list is complete and shows no warning', async () => {
    for (let n = 1; n <= 5; n++) seed(ev(n, { date: `2026-09-0${n}` }));
    fake.tyrePageCap = 2;
    open();
    render(<App />);
    await waitFor(async () => {
      expect(within(await list()).getAllByRole('listitem')).toHaveLength(5);
    });
    expect(fake.tyreGets).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId('partial-warning')).not.toBeInTheDocument();
  });

  it('warns when the device does not hold every event', async () => {
    await setCache('tyre-events', {
      items: [ev(1)],
      next_cursor: '1',
      current_odometer: null,
    });
    server.use(http.all('*/api/v1/*', () => HttpResponse.error()));
    reportReachable(false);
    open();
    render(<App />);
    expect(await screen.findByTestId('partial-warning')).toHaveTextContent('Partial');
  });

  it('shows notes and shop as plain text, never HTML', async () => {
    const html = '<img src=x onerror=alert(1)><b>bold</b>';
    seed(ev(1, { notes: html, shop: html, brand: '<i>x</i>' }));
    open(`/vehicle/tyres/${id(1)}`);
    const { container } = render(<App />);
    expect(await screen.findAllByText(html)).toHaveLength(2);
    expect(screen.getByText('<i>x</i>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('is linked from the Vehicle page Tyres group', async () => {
    seedVehicle(null);
    open('/vehicle');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Tyre changes and rotations' })).toHaveAttribute(
      'href',
      '/vehicle/tyres',
    );
  });
});

describe('AC-75 / AC-76: create', () => {
  it('prefills the current odometer, all four wheels and the size from the tyre spec', async () => {
    seedRecord(12345);
    seedVehicle('255/45 R20');
    const user = open('/vehicle/tyres/new');
    render(<App />);
    await started();
    await waitFor(() => {
      expect(screen.getByLabelText('Odometer (km)')).toHaveValue('12345');
    });
    expect(screen.getByLabelText('Size, optional')).toHaveValue('255/45 R20');
    for (const w of ['Driver front', 'Passenger front', 'Driver rear', 'Passenger rear'])
      expect(screen.getByLabelText(w)).toBeChecked();
    await user.type(screen.getByLabelText('Cost (MYR), optional'), '1200');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.tyrePosts).toHaveLength(1);
    });
    expect(fake.tyrePosts[0]).toMatchObject({
      kind: 'replace',
      wheels: [...ALL],
      odometer: 12345,
      size: '255/45 R20',
      cost_minor: 120000,
      currency: 'MYR',
    });
    expect(fake.expensePosts).toHaveLength(0);
  });

  it('does not prefill the size when the tyre spec is longer than 50 characters', async () => {
    seedVehicle('x'.repeat(51));
    open('/vehicle/tyres/new');
    render(<App />);
    await started();
    expect(screen.getByLabelText('Size, optional')).toHaveValue('');
  });

  it('hides brand, model and size for other kinds and never sends them', async () => {
    seedRecord(500);
    seedVehicle('255/45 R20');
    const user = open('/vehicle/tyres/new');
    render(<App />);
    await started();
    await waitFor(() => {
      expect(screen.getByLabelText('Odometer (km)')).toHaveValue('500');
    });
    await user.type(screen.getByLabelText('Brand, optional'), 'Typed');
    await user.selectOptions(screen.getByLabelText('Type'), 'rotate');
    expect(screen.queryByLabelText('Brand, optional')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Size, optional')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Passenger rear'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.tyrePosts).toHaveLength(1);
    });
    expect(fake.tyrePosts[0]).toMatchObject({
      kind: 'rotate',
      wheels: ['driver_front', 'passenger_front', 'driver_rear'],
      brand: null,
      model: null,
      size: null,
    });
  });

  it('refuses no wheels and a missing odometer without saving anything', async () => {
    const user = open('/vehicle/tyres/new');
    render(<App />);
    await started();
    for (const w of ['Driver front', 'Passenger front', 'Driver rear', 'Passenger rear'])
      await user.click(screen.getByLabelText(w));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Tick at least one wheel.')).toBeInTheDocument();
    expect(screen.getByText('Enter whole kilometres, 0 to 10,000,000.')).toBeInTheDocument();
    expect(await listQueue()).toHaveLength(0);
    expect(fake.tyrePosts).toHaveLength(0);
  });

  it('validateTyreEvent follows the server rules', () => {
    const raw = {
      date: '2026-09-01',
      kind: 'replace',
      wheels: ['passenger_rear', 'driver_front'],
      odometer: '100',
      brand: ' B ',
      model: '',
      size: '',
      cost: '',
      shop: ' ',
      notes: '',
    };
    const ok = validateTyreEvent(raw, '2026-09-01');
    expect(ok.values).toMatchObject({
      wheels: ['driver_front', 'passenger_rear'],
      brand: 'B',
      model: null,
      shop: null,
      cost_minor: null,
    });
    expect(validateTyreEvent({ ...raw, date: '2026-09-02' }, '2026-09-01').date).toBeTruthy();
    expect(validateTyreEvent({ ...raw, date: '1999-12-31' }, '2026-09-01').date).toBeTruthy();
    expect(validateTyreEvent({ ...raw, odometer: '1.5' }, '2026-09-01').odometer).toBeTruthy();
    expect(validateTyreEvent({ ...raw, odometer: '10000001' }, '2026-09-01').odometer).toBeTruthy();
    expect(validateTyreEvent({ ...raw, size: 'x'.repeat(51) }, '2026-09-01').size).toBeTruthy();
    expect(validateTyreEvent({ ...raw, kind: 'swap' }, '2026-09-01').kind).toBeTruthy();
    expect(validateTyreEvent({ ...raw, cost: '1.234' }, '2026-09-01').cost).toBeTruthy();
    const rotate = validateTyreEvent({ ...raw, kind: 'rotate', size: 'kept?' }, '2026-09-01');
    expect(rotate.values).toMatchObject({ brand: null, size: null });
  });
});

describe('AC-78: edit and delete', () => {
  it('edit sends one PATCH and shows the change', async () => {
    seed(ev(1, { notes: 'before' }));
    const user = open(`/vehicle/tyres/${id(1)}/edit`);
    render(<App />);
    const notes = await screen.findByLabelText('Notes');
    await started();
    await user.clear(notes);
    await user.type(notes, 'after');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('after')).toBeInTheDocument();
    await waitFor(() => {
      expect(fake.tyrePatches).toHaveLength(1);
    });
    expect(fake.tyrePatches[0]).toMatchObject({ notes: 'after' });
    expect(fake.tyreEvents.get(id(1))?.notes).toBe('after');
  });

  it('delete asks first; Cancel keeps it, Delete removes it', async () => {
    seed(ev(1));
    const user = open(`/vehicle/tyres/${id(1)}`);
    render(<App />);
    await started();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this tyre event?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fake.tyreDeletes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByText('No tyre events yet.')).toBeInTheDocument();
    await waitFor(() => {
      expect(fake.tyreDeletes).toEqual([id(1)]);
    });
    expect(fake.tyreEvents.size).toBe(0);
  });

  it('a DELETE answered 404 (already gone) is treated as done', async () => {
    seed(ev(1));
    const user = open(`/vehicle/tyres/${id(1)}`);
    render(<App />);
    await started();
    fake.tyreEvents.clear(); // deleted elsewhere
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(fake.tyreDeletes).toEqual([id(1)]);
    });
    await waitFor(async () => {
      expect(await listQueue()).toHaveLength(0);
    });
    expect(screen.queryByTestId('sync-failed')).not.toBeInTheDocument();
  });
});

describe('AC-81: offline', () => {
  it('create offline is pending, survives a reload and is POSTed exactly once', async () => {
    const user = open('/vehicle/tyres/new');
    const first = render(<App />);
    await screen.findByLabelText('Odometer (km)');
    await started();
    reportReachable(false);
    await user.type(screen.getByLabelText('Odometer (km)'), '777');
    await user.type(screen.getByLabelText('Notes'), 'offline tyre');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    expect(fake.tyrePosts).toHaveLength(0);
    first.unmount();
    await closeDbForTests();
    expect(await listQueue()).toHaveLength(1);
    window.history.pushState(null, '', '/vehicle/tyres');
    reportReachable(false);
    render(<App />);
    expect(await screen.findByText('offline tyre')).toBeInTheDocument();
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.tyrePosts).toHaveLength(1);
    expect(fake.tyreEvents.size).toBe(1);
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('AC-83: rotation reminder', () => {
  it('opens Add reminder prefilled with Service, "Rotate tyres" and odometer + N; saves nothing', async () => {
    seed(rot(1, { odometer: 20000 }));
    const user = open(`/vehicle/tyres/${id(1)}`);
    render(<App />);
    await started();
    const input = await screen.findByLabelText('Rotate again after (km)');
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Add rotation reminder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('whole kilometres');
    await user.type(input, '10000');
    await user.click(screen.getByRole('button', { name: 'Add rotation reminder' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Rotate tyres');
    expect(window.location.pathname).toBe('/reminders/new');
    expect(screen.getByLabelText('Kind')).toHaveValue('service');
    expect(screen.getByLabelText('Due odometer (km)')).toHaveValue('30000');
    expect(fake.reminderPosts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.reminderPosts).toHaveLength(1);
    });
    expect(fake.reminderPosts[0]).toMatchObject({
      kind: 'service',
      title: 'Rotate tyres',
      due_odometer: 30000,
    });
  });

  it('is offered only on Rotate events', async () => {
    seed(ev(1));
    open(`/vehicle/tyres/${id(1)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Rotate again after (km)')).not.toBeInTheDocument();
  });
});
