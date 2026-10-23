import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import { klToday } from '../src/lib/dates';
import { listQueue } from '../src/storage/queue';
import { closeDbForTests } from '../src/storage/db';
import { flush } from '../src/sync/engine';
import { fake, server, TEMPLATE } from './server';
import type { Reminder } from '../src/api/types';

afterEach(() => {
  vi.useRealTimers();
});

const IDS = [
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000004',
];
const STAMP = '2026-10-01T00:00:00Z';

function rem(id: string, over: Partial<Reminder> = {}): Reminder {
  return {
    id,
    kind: 'service',
    title: 'Reminder',
    due_date: null,
    due_odometer: null,
    notes: null,
    completed_on: null,
    template_ref: null,
    status: 'upcoming',
    overdue_by: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
function seedRecord(odometer: number, date = '2026-09-01') {
  const id = 'b0000000-0000-4000-8000-000000000001';
  fake.records.set(id, {
    id,
    date,
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
function open(path = '/reminders') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}
const plusDays = (n: number) => {
  const [y, m, d] = klToday().split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
};

describe('AC-18 / AC-16 / AC-15: the reminders page', () => {
  it('groups Overdue and Upcoming, hides Completed until filtered, shows the odometer basis', async () => {
    seedRecord(21000);
    fake.reminders.set(
      IDS[0] ?? '',
      rem(IDS[0] ?? '', { title: 'Late by date', due_date: plusDays(-3) }),
    );
    fake.reminders.set(
      IDS[1] ?? '',
      rem(IDS[1] ?? '', { title: 'Late by km', due_odometer: 20000 }),
    );
    fake.reminders.set(
      IDS[2] ?? '',
      rem(IDS[2] ?? '', { title: 'Soon', due_date: plusDays(5), kind: 'insurance_renewal' }),
    );
    fake.reminders.set(
      IDS[3] ?? '',
      rem(IDS[3] ?? '', {
        title: 'Done one',
        due_date: plusDays(-30),
        completed_on: plusDays(-1),
        status: 'completed',
      }),
    );
    const user = open();
    render(<App />);
    const overdue = await screen.findByRole('list', { name: 'Overdue reminders' });
    expect(
      within(overdue)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Late by date'), expect.stringContaining('Late by km')]);
    expect(within(overdue).getByText(/3 days overdue/)).toBeInTheDocument();
    expect(within(overdue).getByText(/1,000 km overdue/)).toBeInTheDocument();
    const upcoming = screen.getByRole('list', { name: 'Upcoming reminders' });
    expect(within(upcoming).getByText(/Soon/)).toBeInTheDocument();
    expect(within(upcoming).getByText('Due soon')).toBeInTheDocument();
    expect(screen.queryByText('Done one')).not.toBeInTheDocument();
    expect(screen.getByTestId('odometer-basis')).toHaveTextContent(/21,000 km/);
    expect(screen.getByTestId('odometer-basis')).toHaveTextContent(/service record dated/);
    expect(screen.getByText(/no push, email or other notification/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Completed \(1\)/));
    expect(await screen.findByText('Done one')).toBeInTheDocument();
  });

  it('says "odometer unknown" and does not mark odometer reminders overdue without a service record', async () => {
    fake.reminders.set(IDS[0] ?? '', rem(IDS[0] ?? '', { title: 'Km only', due_odometer: 100 }));
    open();
    render(<App />);
    const upcoming = await screen.findByRole('list', { name: 'Upcoming reminders' });
    expect(within(upcoming).getAllByText(/odometer unknown/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('list', { name: 'Overdue reminders' })).not.toBeInTheDocument();
  });

  it('shows the road tax kind with the label "Road tax (JPJ)" and no fees', async () => {
    const user = open('/reminders/new');
    render(<App />);
    await user.selectOptions(await screen.findByLabelText('Kind'), 'road_tax_renewal');
    expect(screen.getAllByText(/Road tax \(JPJ\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/does not contact JPJ/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Due odometer/)).not.toBeInTheDocument();
  });

  it('AC-28: a script-like title is shown literally and runs nothing', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    fake.reminders.set(
      IDS[0] ?? '',
      rem(IDS[0] ?? '', { title: xss, due_date: plusDays(10), notes: xss }),
    );
    const user = open();
    render(<App />);
    expect(await screen.findByText(xss)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    await user.click(screen.getByText(xss));
    expect((await screen.findAllByText(xss)).length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('AC-10 / AC-13 / AC-14 / AC-19: create, edit, complete, reopen, delete', () => {
  it('creates a reminder with one POST, then edits, completes, reopens and deletes it', async () => {
    const user = open('/reminders/new');
    render(<App />);
    await screen.findByLabelText('Title');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0); // app-start sync has finished
    });
    await user.type(screen.getByLabelText('Title'), 'Oil change');
    await user.type(screen.getByLabelText('Due date'), '2027-03-01');
    await user.type(screen.getByLabelText('Due odometer (km)'), '30000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.reminders.size).toBe(1);
    });
    expect(fake.reminderPosts).toHaveLength(1);
    const id = [...fake.reminders.keys()][0] ?? '';
    await user.click(await screen.findByText('Oil change'));
    await user.click(await screen.findByRole('link', { name: 'Edit' }));
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Oil change v2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(fake.reminders.get(id)?.title).toBe('Oil change v2');
    });
    await user.click(await screen.findByRole('button', { name: 'Mark complete' }));
    await waitFor(() => {
      expect(fake.reminders.get(id)?.completed_on).toBe(klToday());
    });
    await user.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => {
      expect(fake.reminders.get(id)?.completed_on).toBeNull();
    });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(fake.reminderDeletes).toHaveLength(0); // asked first
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(fake.reminders.size).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(fake.reminders.size).toBe(0);
    });
  });

  it('blocks a reminder with neither due field before anything is sent', async () => {
    const user = open('/reminders/new');
    render(<App />);
    await user.type(await screen.findByLabelText('Title'), 'No due');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Enter a due date, a due odometer, or both/),
    ).toBeInTheDocument();
    expect(fake.reminderPosts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('AC-24 / AC-25: offline', () => {
  it('cold start with the API down still lists cached reminders and says status is computed on-device', async () => {
    fake.reminders.set(
      IDS[0] ?? '',
      rem(IDS[0] ?? '', { title: 'Cached one', due_date: plusDays(-2) }),
    );
    open();
    const first = render(<App />);
    await screen.findByText('Cached one');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0);
    });
    first.unmount();
    server.use(http.all('*/api/v1/*', () => HttpResponse.error()));
    reportReachable(false);
    render(<App />);
    const overdue = await screen.findByRole('list', { name: 'Overdue reminders' });
    expect(within(overdue).getByText('Cached one')).toBeInTheDocument();
    expect(screen.getByTestId('status-computed-offline')).toHaveTextContent(
      /worked out on this device/,
    );
  });

  it('create offline is pending, survives a reload and is POSTed exactly once on reconnect', async () => {
    const user = open('/reminders/new');
    const first = render(<App />);
    await screen.findByLabelText('Title');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0); // app-start sync has finished
    });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the last response land first
    reportReachable(false);
    await user.type(await screen.findByLabelText('Title'), 'Offline made');
    await user.type(screen.getByLabelText('Due date'), '2027-05-05');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    expect(fake.reminderPosts).toHaveLength(0);
    first.unmount();
    await closeDbForTests(); // a reload: the queue must come back from IndexedDB
    expect(await listQueue()).toHaveLength(1);
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.reminderPosts).toHaveLength(1);
    expect(fake.reminders.size).toBe(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('a lost response is retried with the same id and creates no duplicate (replay 200)', async () => {
    const user = open('/reminders/new');
    fake.reminderPostFailures = [500];
    render(<App />);
    await user.type(await screen.findByLabelText('Title'), 'Retry me');
    await user.type(screen.getByLabelText('Due date'), '2027-05-05');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.reminderPosts).toHaveLength(1);
    });
    await flush(true);
    expect(fake.reminderPosts).toHaveLength(2);
    expect((fake.reminderPosts[0] as Reminder).id).toBe((fake.reminderPosts[1] as Reminder).id);
    expect(fake.reminders.size).toBe(1);
    // identical replay of an already stored reminder: the server answers 200 and the queue clears
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
  });

  it('offline complete and delete of a synced reminder are queued and sent once', async () => {
    fake.reminders.set(
      IDS[0] ?? '',
      rem(IDS[0] ?? '', { title: 'Two actions', due_date: plusDays(9) }),
    );
    fake.reminders.set(
      IDS[1] ?? '',
      rem(IDS[1] ?? '', { title: 'To delete', due_date: plusDays(9) }),
    );
    const user = open();
    render(<App />);
    await screen.findByText('Two actions');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0); // app-start sync has finished
    });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the last response land first
    reportReachable(false);
    await user.click(screen.getByText('Two actions'));
    await user.click(await screen.findByRole('button', { name: 'Mark complete' }));
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(await screen.findByText('To delete'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(fake.reminderPatches).toHaveLength(0);
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.reminderPatches).toHaveLength(1);
    expect(fake.reminderDeletes).toHaveLength(1);
    expect(fake.reminders.get(IDS[0] ?? '')?.completed_on).toBe(klToday());
  });
});

describe('AC-20 / AC-21 / AC-22 / AC-23: the template review', () => {
  it('opening the template, then leaving or cancelling, creates nothing', async () => {
    const user = open();
    render(<App />);
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0);
    });
    await user.click(await screen.findByRole('link', { name: 'Suggested service schedule' }));
    expect(await screen.findByTestId('template-source')).toHaveTextContent(/M12.*verified/);
    expect(screen.getByTestId('template-caveat')).toHaveTextContent(
      /Confirm against your own booklet/,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.reminderPosts).toHaveLength(0);
    expect(fake.reminders.size).toBe(0);
    expect(await listQueue()).toHaveLength(0);
    expect(await screen.findByText('No reminders yet.')).toBeInTheDocument();
  });

  it('app start, a saved vehicle and service records alone create no reminder', async () => {
    seedRecord(5000);
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      make: 'Zeekr',
      model: '7X',
      variant: 'AWD Performance',
      model_year: 2025,
      purchase_date: '2025-01-15',
      vin: null,
      plate: null,
      current_odometer_hint: null,
      created_at: STAMP,
      updated_at: STAMP,
    } as never;
    open();
    render(<App />);
    expect(await screen.findByText('No reminders yet.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.reminderPosts).toHaveLength(0);
    expect(fake.reminders.size).toBe(0);
  });

  it('preselects only the next checkpoint, requires a baseline, and creates one reminder per selected item', async () => {
    seedRecord(25000); // next checkpoint above 25,000 km is #2
    const user = open('/reminders/template');
    render(<App />);
    await screen.findByTestId('template-source');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, false, false]);
    // No baseline yet (no vehicle purchase date): accepting is refused and nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Create selected reminders' }));
    expect(
      await screen.findByText('Enter the baseline date before accepting.'),
    ).toBeInTheDocument();
    expect(fake.reminderPosts).toHaveLength(0);
    await user.type(screen.getByLabelText(/Baseline date/), '2026-01-31');
    expect(screen.getByLabelText('Due date', { selector: '#cp2-date' })).toHaveValue('2028-01-31');
    await user.click(boxes[2] as HTMLElement);
    const title = screen.getByLabelText('Title', { selector: '#cp2-title' });
    await user.clear(title);
    await user.type(title, 'My edited title');
    await user.click(screen.getByRole('button', { name: 'Create selected reminders' }));
    await waitFor(() => {
      expect(fake.reminders.size).toBe(2);
    });
    expect(fake.reminderPosts).toHaveLength(2);
    const made = [...fake.reminders.values()];
    expect(made.map((m) => m.template_ref).sort()).toEqual([
      'awd-performance-service:1:2',
      'awd-performance-service:1:3',
    ]);
    expect(made.find((m) => m.template_ref?.endsWith(':2'))?.title).toBe('My edited title');
    // Odd checkpoint: work items are not stated, nothing invented.
    expect(made.find((m) => m.template_ref?.endsWith(':3'))?.notes).toMatch(/not stated/);
  });

  it('prefills the baseline from the vehicle purchase date and labels it a guess', async () => {
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      purchase_date: '2025-03-10',
    } as never;
    open('/reminders/template');
    render(<App />);
    const baseline = await screen.findByLabelText(/Baseline date/);
    await waitFor(() => {
      expect(baseline).toHaveValue('2025-03-10');
    });
    expect(
      screen.getByText(/Prefilled from the vehicle purchase date. This is a guess/),
    ).toBeInTheDocument();
  });

  it('offline accept queues one create per item; one failing item does not block the others', async () => {
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      purchase_date: '2025-03-10',
    } as never;
    const user = open('/reminders/template');
    render(<App />);
    await screen.findByTestId('template-source');
    await waitFor(() => {
      expect(screen.getByLabelText(/Baseline date/)).toHaveValue('2025-03-10');
    });
    await user.click(screen.getAllByRole('checkbox')[1] as HTMLElement);
    reportReachable(false);
    await user.click(screen.getByRole('button', { name: 'Create selected reminders' }));
    await waitFor(async () => {
      expect(await listQueue()).toHaveLength(2);
    });
    expect(fake.reminderPosts).toHaveLength(0);
    fake.reminderPostFailures = [400]; // the first item is refused
    reportReachable(true);
    await flush(true);
    expect(fake.reminders.size).toBe(1);
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.status).toBe('failed');
  });

  it('says it needs one online visit when the template was never fetched', async () => {
    server.use(http.get('*/api/v1/reminder-templates', () => HttpResponse.error()));
    open('/reminders/template');
    render(<App />);
    expect(await screen.findByText(/needs one online visit/)).toBeInTheDocument();
    expect(TEMPLATE.checkpoints.length).toBeGreaterThan(0);
  });
});
