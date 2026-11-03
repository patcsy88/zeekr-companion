import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import { fake } from './server';
import type { Reminder } from '../src/api/types';

const ID = 'a0000000-0000-4000-8000-0000000000c1';
const STAMP = '2026-10-01T00:00:00Z';

function seed(over: Partial<Reminder> = {}) {
  fake.reminders.set(ID, {
    id: ID,
    kind: 'service',
    title: 'Service 1 (40,000 km)',
    due_date: '2027-10-07',
    due_odometer: 40000,
    notes: null,
    completed_on: null,
    template_ref: 'awd-performance-service:2:1',
    status: 'upcoming',
    overdue_by: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  });
}
function open(path: string) {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

afterEach(() => {
  reportReachable(true);
});

async function synced() {
  await waitFor(() => {
    expect(fake.templateGets).toBeGreaterThan(0); // the last request of the app-start sync
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe('Complete service', () => {
  it('records the service, completes the reminder and shows the next one', async () => {
    seed();
    const user = open(`/reminders/${ID}`);
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Complete service' }));
    const odo = await screen.findByLabelText(/Odometer/);
    await user.clear(odo);
    await user.type(odo, '38500');
    await user.type(screen.getByLabelText('Service centre'), 'Centre A');
    await user.click(screen.getByRole('button', { name: 'Complete service' }));
    await waitFor(() => {
      expect(fake.completePosts).toHaveLength(1);
    });
    const body = fake.completePosts[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      odometer: 38500,
      provider: 'Centre A',
      cost_minor: 0,
      description: 'Service 1 (40,000 km)',
    });
    expect(body.record_id).not.toEqual(body.next_id);
    expect(fake.reminders.get(ID)?.completed_on).not.toBeNull();
    expect([...fake.reminders.values()].some((r) => r.title === 'Next service (78,500 km)')).toBe(
      true,
    );
  });

  it('shows a field error from the server and sends nothing else', async () => {
    seed();
    const user = open(`/reminders/${ID}/complete`);
    render(<App />);
    const odo = await screen.findByLabelText(/Odometer/);
    await user.clear(odo);
    await user.type(odo, '666');
    await user.click(screen.getByRole('button', { name: 'Complete service' }));
    expect(await screen.findByText(/rejected by test/)).toBeInTheDocument();
    expect(fake.reminders.get(ID)?.completed_on).toBeNull();
  });

  it('rejects a bad odometer on the device without calling the server', async () => {
    seed();
    const user = open(`/reminders/${ID}/complete`);
    render(<App />);
    const odo = await screen.findByLabelText(/Odometer/);
    await user.clear(odo);
    await user.type(odo, 'abc');
    await user.click(screen.getByRole('button', { name: 'Complete service' }));
    expect(await screen.findByText(/whole kilometres/)).toBeInTheDocument();
    expect(fake.completePosts).toHaveLength(0);
  });

  it('is disabled with an explanation while offline', async () => {
    seed();
    const user = open(`/reminders/${ID}`);
    render(<App />);
    await screen.findByRole('link', { name: 'Complete service' });
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0); // the last request of the app-start sync
    });
    // A response that lands after reportReachable(false) would mark the API reachable again.
    await new Promise((resolve) => setTimeout(resolve, 150));
    reportReachable(false);
    expect(await screen.findByText(/needs a connection/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Complete service' });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(fake.completePosts).toHaveLength(0);
  });

  it('does not submit while offline, even when the form is submitted without the button', async () => {
    seed();
    open(`/reminders/${ID}/complete`);
    render(<App />);
    await screen.findByLabelText(/Odometer/);
    await synced();
    reportReachable(false);
    await screen.findByText(/needs a connection/);
    const form = screen.getByRole('button', { name: 'Complete service' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fake.completePosts).toHaveLength(0);
    expect(fake.reminders.get(ID)?.completed_on).toBeNull();
  });

  it('a double click sends the same ids every time', async () => {
    seed();
    const user = open(`/reminders/${ID}/complete`);
    render(<App />);
    const odo = await screen.findByLabelText(/Odometer/);
    await user.clear(odo);
    await user.type(odo, '38500');
    await user.dblClick(screen.getByRole('button', { name: 'Complete service' }));
    await waitFor(() => {
      expect(fake.completePosts.length).toBeGreaterThan(0);
    });
    const ids = new Set(
      (fake.completePosts as { record_id: string; next_id: string }[]).map(
        (b) => `${b.record_id}/${b.next_id}`,
      ),
    );
    expect(ids.size).toBe(1);
    expect([...fake.records.keys()]).toHaveLength(1);
  });

  it('keeps Mark complete for other kinds of reminder', async () => {
    seed({ kind: 'insurance_renewal', due_odometer: null, template_ref: null });
    open(`/reminders/${ID}`);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    expect(screen.queryByText('Complete service')).not.toBeInTheDocument();
  });
});
