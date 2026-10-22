import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { klToday } from '../src/lib/dates';
import { computeStatus, daysBetween, isDueSoon } from '../src/lib/reminderStatus';
import {
  enqueueReminderCreate,
  enqueueReminderDelete,
  enqueueReminderEdit,
  listQueue,
} from '../src/storage/queue';
import { fake } from './server';

function open(path: string) {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('QA: Kuala Lumpur "today" on the device (owner decision 2026-10-22)', () => {
  it('rolls over at 16:00 UTC, which is 00:00 in Asia/Kuala_Lumpur', () => {
    expect(klToday(new Date('2026-10-21T15:59:59Z'))).toBe('2026-10-21');
    expect(klToday(new Date('2026-10-21T16:00:00Z'))).toBe('2026-10-22');
  });

  it('is ahead of the UTC date between 16:00 and 24:00 UTC, including across a year end', () => {
    expect(klToday(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
    expect(klToday(new Date('2028-02-28T16:00:00Z'))).toBe('2028-02-29');
  });
});

describe('QA: status edges (AC-17)', () => {
  const none = { due_date: null, due_odometer: null, completed_on: null };

  it('due today and due at exactly the current odometer are upcoming, not overdue', () => {
    expect(computeStatus({ ...none, due_date: '2026-10-22' }, null, '2026-10-22').status).toBe(
      'upcoming',
    );
    expect(computeStatus({ ...none, due_odometer: 20000 }, 20000, '2026-10-22').status).toBe(
      'upcoming',
    );
  });

  it('one day or one km past is overdue, and reports which condition fired', () => {
    expect(computeStatus({ ...none, due_date: '2026-10-21' }, null, '2026-10-22')).toEqual({
      status: 'overdue',
      overdue_by: ['date'],
    });
    expect(computeStatus({ ...none, due_odometer: 20000 }, 20001, '2026-10-22')).toEqual({
      status: 'overdue',
      overdue_by: ['odometer'],
    });
    expect(
      computeStatus({ ...none, due_date: '2026-10-21', due_odometer: 1 }, 2, '2026-10-22')
        .overdue_by,
    ).toEqual(['date', 'odometer']);
  });

  it('an unknown odometer never makes an odometer reminder overdue', () => {
    expect(computeStatus({ ...none, due_odometer: 0 }, null, '2099-01-01').status).toBe('upcoming');
  });

  it('a completed reminder is never overdue, even far past both limits', () => {
    expect(
      computeStatus(
        { due_date: '2000-01-01', due_odometer: 1, completed_on: '2026-10-22' },
        999999,
        '2026-10-22',
      ),
    ).toEqual({ status: 'completed', overdue_by: [] });
  });

  it('daysBetween handles month ends, leap days and negative spans', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-10-22', '2026-10-20')).toBe(-2);
  });

  it('"due soon" is display only: 30 days and 1,000 km inclusive, never for overdue or completed', () => {
    const today = '2026-10-22';
    expect(isDueSoon({ ...none, due_date: '2026-11-21' }, null, today)).toBe(true);
    expect(isDueSoon({ ...none, due_date: '2026-11-22' }, null, today)).toBe(false);
    expect(isDueSoon({ ...none, due_odometer: 21000 }, 20000, today)).toBe(true);
    expect(isDueSoon({ ...none, due_odometer: 21001 }, 20000, today)).toBe(false);
    expect(isDueSoon({ ...none, due_date: '2026-10-21' }, null, today)).toBe(false);
    expect(
      isDueSoon(
        { due_date: '2026-10-25', due_odometer: null, completed_on: '2026-10-22' },
        null,
        today,
      ),
    ).toBe(false);
  });
});

describe('QA: offline queue edge cases (AC-25)', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const body = {
    id: ID,
    kind: 'service' as const,
    title: 'Queue QA',
    due_date: '2027-01-01',
    due_odometer: null,
    notes: null,
    template_ref: null,
  };

  it('two creates with the same id leave a single queue entry', async () => {
    await enqueueReminderCreate(body);
    await enqueueReminderCreate(body);
    expect((await listQueue()).filter((e) => e.record_id === ID)).toHaveLength(1);
  });

  it('create, edit, delete, create again leaves exactly one POST with the new content', async () => {
    await enqueueReminderCreate(body);
    await enqueueReminderEdit(ID, { title: 'Edited' });
    await enqueueReminderDelete(ID);
    expect(await listQueue()).toHaveLength(0);
    await enqueueReminderCreate({ ...body, title: 'Second life' });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ method: 'POST', body: { title: 'Second life' } });
  });
});

describe('QA: the form refuses bad input before anything is sent (AC-12)', () => {
  async function fillAndSave(fields: { title?: string; date?: string; km?: string }) {
    const user = open('/reminders/new');
    render(<App />);
    if (fields.title !== undefined) {
      await user.type(await screen.findByLabelText('Title'), fields.title);
    } else {
      await screen.findByLabelText('Title');
    }
    if (fields.date) await user.type(screen.getByLabelText('Due date'), fields.date);
    if (fields.km) await user.type(screen.getByLabelText('Due odometer (km)'), fields.km);
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it.each([
    ['whitespace-only title', { title: '   ', date: '2027-03-01' }],
    ['negative odometer', { title: 'Neg', km: '-5' }],
    ['fractional odometer', { title: 'Frac', km: '1.5' }],
    ['odometer above 10,000,000', { title: 'Huge', km: '10000001' }],
  ])('%s sends nothing and queues nothing', async (_name, fields) => {
    await fillAndSave(fields);
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.reminderPosts).toHaveLength(0);
    expect(fake.reminders.size).toBe(0);
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('QA: template accept with nothing selected (AC-21)', () => {
  it('creates nothing and queues nothing', async () => {
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      purchase_date: '2025-03-10',
    } as never;
    const user = open('/reminders/template');
    render(<App />);
    await screen.findByTestId('template-source');
    for (const box of screen.getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) await user.click(box);
    }
    await user.click(screen.getByRole('button', { name: 'Create selected reminders' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(fake.reminderPosts).toHaveLength(0);
    expect(fake.reminders.size).toBe(0);
    expect(await listQueue()).toHaveLength(0);
  });
});
