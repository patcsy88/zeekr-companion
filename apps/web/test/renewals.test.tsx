import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { renewalSummary } from '../src/lib/reminderText';
import { validateReminder } from '../src/components/ReminderForm';
import { fake } from './server';
import type { Reminder } from '../src/api/types';

afterEach(() => {
  vi.useRealTimers();
});

const A = 'c0000000-0000-4000-8000-000000000001';
const B = 'c0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const STAMP = '2026-10-01T00:00:00Z';

function rem(id: string, over: Partial<Reminder> = {}): Reminder {
  return {
    id,
    kind: 'insurance_renewal',
    title: 'Insurance',
    due_date: '2027-03-01',
    due_odometer: null,
    notes: null,
    completed_on: null,
    template_ref: null,
    insurer: null,
    cover_type: null,
    premium_minor: null,
    insurer_phone: null,
    amount_minor: null,
    status: 'upcoming',
    overdue_by: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}

function open(path: string) {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('AC-108: renewal details', () => {
  it('shows the insurance fields and the privacy line, and sends them', async () => {
    const user = open('/reminders/new');
    render(<App />);
    await screen.findByLabelText('Title');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0);
    });
    expect(screen.queryByLabelText('Insurer')).toBeNull();
    expect(screen.queryByTestId('renewal-privacy')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Kind'), 'insurance_renewal');
    expect(screen.queryByLabelText('Amount (MYR)')).toBeNull();
    expect(screen.getByTestId('renewal-privacy')).toHaveTextContent(/unencrypted on this phone/);
    await user.type(screen.getByLabelText('Title'), 'Car insurance');
    await user.type(screen.getByLabelText('Due date'), '2027-03-01');
    await user.type(screen.getByLabelText('Insurer'), 'Example Insurer');
    await user.selectOptions(screen.getByLabelText('Cover type'), 'third_party');
    await user.type(screen.getByLabelText('Premium (MYR)'), '1,234.50');
    await user.type(screen.getByLabelText('Insurer phone'), '+60 3 0000 0000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.reminderPosts).toHaveLength(1);
    });
    expect(fake.reminderPosts[0]).toMatchObject({
      kind: 'insurance_renewal',
      insurer: 'Example Insurer',
      cover_type: 'third_party',
      premium_minor: 123450,
      insurer_phone: '+60 3 0000 0000',
      amount_minor: null,
    });
  });

  it('shows only the amount for road tax and sends null for the insurance fields', async () => {
    const user = open('/reminders/new');
    render(<App />);
    await screen.findByLabelText('Title');
    await waitFor(() => {
      expect(fake.templateGets).toBeGreaterThan(0);
    });
    await user.selectOptions(screen.getByLabelText('Kind'), 'road_tax_renewal');
    expect(screen.queryByLabelText('Insurer')).toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Road tax');
    await user.type(screen.getByLabelText('Due date'), '2027-03-01');
    await user.type(screen.getByLabelText('Amount (MYR)'), '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.reminderPosts).toHaveLength(1);
    });
    expect(fake.reminderPosts[0]).toMatchObject({
      amount_minor: 9000,
      insurer: null,
      premium_minor: null,
    });
  });

  it('does not show renewal fields on a service reminder', async () => {
    open('/reminders/new');
    render(<App />);
    await screen.findByLabelText('Title');
    expect(screen.queryByLabelText('Insurer')).toBeNull();
    expect(screen.queryByLabelText('Amount (MYR)')).toBeNull();
  });

  it('clears the insurance fields when the kind changes to road tax', async () => {
    fake.reminders.set(
      A,
      rem(A, { insurer: 'Example Insurer', cover_type: 'comprehensive', premium_minor: 5000 }),
    );
    const user = open(`/reminders/${A}/edit`);
    render(<App />);
    expect(await screen.findByLabelText('Insurer')).toHaveValue('Example Insurer');
    expect(screen.getByLabelText('Premium (MYR)')).toHaveValue('50.00');
    await user.selectOptions(screen.getByLabelText('Kind'), 'road_tax_renewal');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(fake.reminderPatches).toHaveLength(1);
    });
    expect(fake.reminderPatches[0]).toMatchObject({
      kind: 'road_tax_renewal',
      insurer: null,
      cover_type: null,
      premium_minor: null,
      insurer_phone: null,
      amount_minor: null,
    });
  });

  it('shows the details on the reminder page', async () => {
    fake.reminders.set(
      A,
      rem(A, {
        insurer: 'Example Insurer',
        cover_type: 'third_party_fire_theft',
        premium_minor: 123450,
        insurer_phone: '+60 3 0000 0000',
      }),
    );
    open(`/reminders/${A}`);
    render(<App />);
    expect(await screen.findByText('Example Insurer')).toBeInTheDocument();
    expect(screen.getByText('Third party, fire and theft')).toBeInTheDocument();
    expect(screen.getByText('RM 1,234.50')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+60 3 0000 0000' })).toHaveAttribute(
      'href',
      'tel:+60 3 0000 0000',
    );
  });

  it('checks the money and length rules before sending', () => {
    const base = {
      kind: 'insurance_renewal' as const,
      title: 'x',
      due_date: '2027-01-01',
      due_odometer: '',
      notes: '',
    };
    expect(validateReminder({ ...base, premium: 'abc' }).premium).toBeDefined();
    expect(validateReminder({ ...base, premium: '1000000.01' }).premium).toBe(
      'At most RM 1,000,000.00.',
    );
    expect(validateReminder({ ...base, premium: '1000000' }).premium).toBeUndefined();
    expect(validateReminder({ ...base, insurer: 'x'.repeat(201) }).insurer).toBeDefined();
    expect(
      validateReminder({ ...base, insurer_phone: '1'.repeat(31) }).insurer_phone,
    ).toBeDefined();
    const tax = { ...base, kind: 'road_tax_renewal' as const };
    expect(validateReminder({ ...tax, amount: '-5' }).amount).toBeDefined();
    expect(validateReminder({ ...tax, amount: '' }).amount).toBeUndefined();
    expect(validateReminder({ ...base, kind: 'service' as const, premium: 'abc' }).premium).toBe(
      undefined,
    );
  });

  it('summarises a renewal on one line', () => {
    expect(
      renewalSummary(
        rem(A, { insurer: 'Example Insurer', cover_type: 'comprehensive', premium_minor: 5000 }),
      ),
    ).toBe('Example Insurer · Comprehensive · RM 50.00');
    expect(renewalSummary(rem(A))).toBeNull();
    expect(renewalSummary(rem(B, { kind: 'road_tax_renewal', amount_minor: 9000 }))).toBe(
      'RM 90.00',
    );
    expect(renewalSummary(rem(C, { kind: 'service', due_odometer: 5 }))).toBeNull();
  });
});

describe('AC-108: the Renewals page', () => {
  it('lists road tax and insurance only, with their details, under the Setup sub-tabs', async () => {
    fake.reminders.set(A, rem(A, { title: 'Car insurance', insurer: 'Example Insurer' }));
    fake.reminders.set(
      B,
      rem(B, { kind: 'road_tax_renewal', title: 'Road tax', amount_minor: 9000 }),
    );
    fake.reminders.set(C, rem(C, { kind: 'service', title: 'Oil service', due_odometer: 100 }));
    open('/setup/renewals');
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Open renewals' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(list).toHaveTextContent('Example Insurer');
    expect(list).toHaveTextContent('RM 90.00');
    expect(screen.queryByText('Oil service')).toBeNull();
    const row = screen.getByRole('navigation', { name: 'Setup pages' });
    expect(
      within(row)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Profile', 'Renewals', 'Notifications']);
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('link', { name: 'Setup' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('says so when there are no renewals', async () => {
    fake.reminders.set(C, rem(C, { kind: 'service', title: 'Oil service', due_odometer: 100 }));
    open('/setup/renewals');
    render(<App />);
    expect(await screen.findByText('No renewals yet.')).toBeInTheDocument();
  });

  it('shows completed renewals under Done', async () => {
    fake.reminders.set(
      A,
      rem(A, { title: 'Old insurance', completed_on: '2026-09-01', status: 'completed' }),
    );
    open('/setup/renewals');
    render(<App />);
    expect(await screen.findByText('Nothing open.')).toBeInTheDocument();
    const done = screen.getByRole('list', { name: 'Completed renewals' });
    expect(done).toHaveTextContent('Old insurance');
  });
});
