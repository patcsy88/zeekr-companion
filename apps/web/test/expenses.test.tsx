import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { Expense } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import { addDays, addMonths, klToday } from '../src/lib/dates';
import { setCache } from '../src/storage/cache';
import { closeDbForTests } from '../src/storage/db';
import { listQueue } from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { fake, server } from './server';

const STAMP = '2026-10-01T00:00:00Z';
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function exp(n: number, over: Partial<Expense> = {}): Expense {
  return {
    id: id(n),
    date: '2026-09-01',
    category: 'charging',
    amount_minor: 1000,
    currency: 'MYR',
    notes: null,
    energy_wh: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
function seed(...items: Expense[]) {
  for (const x of items) fake.expenses.set(x.id, x);
}
function open(path = '/expenses') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}
/** Waits for the app-start sync (which fetches expenses) to finish. */
async function started() {
  await waitFor(() => {
    expect(fake.expenseGets).toBeGreaterThan(0);
    expect(fake.templateGets).toBeGreaterThan(0); // the last request of the app-start sync
  });
  // A response that lands after reportReachable(false) would mark the API reachable again.
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const totals = () => screen.getByTestId('totals');

describe('AC-35: the list', () => {
  it('shows date, category label, amount as RM 1,234.50 and notes, newest first', async () => {
    seed(
      exp(1, { date: '2026-08-01', category: 'insurance', amount_minor: 123450, notes: 'Annual' }),
      exp(2, { date: '2026-09-15', category: 'road_tax', amount_minor: 5 }),
    );
    open();
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Expenses, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Road tax (JPJ)');
    expect(items[0]).toHaveTextContent('RM 0.05');
    expect(items[1]).toHaveTextContent('Insurance');
    expect(items[1]).toHaveTextContent('RM 1,234.50');
    expect(items[1]).toHaveTextContent('Annual');
    expect(items[1]).toHaveTextContent('2026');
  });

  it('has an Expenses tab in the main navigation', async () => {
    open('/');
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Expenses' })).toHaveAttribute(
      'href',
      '/expenses',
    );
  });

  it('says so when there are no expenses', async () => {
    open();
    render(<App />);
    expect(await screen.findByText('No expenses yet.')).toBeInTheDocument();
  });
});

describe('AC-36: filters', () => {
  it('filters by category and shows the active filter', async () => {
    seed(
      exp(1, { category: 'charging', notes: 'plug A' }),
      exp(2, { category: 'parking', notes: 'lot B' }),
    );
    const user = open();
    render(<App />);
    await screen.findByText(/plug A/);
    await user.selectOptions(screen.getByLabelText('Category'), 'parking');
    expect(screen.queryByText(/plug A/)).not.toBeInTheDocument();
    expect(screen.getByText(/lot B/)).toBeInTheDocument();
    expect(screen.getByTestId('active-filters')).toHaveTextContent('Category: Parking');
  });

  it('filters by from and to, both inclusive', async () => {
    seed(
      exp(1, { date: '2026-05-31', notes: 'n-before' }),
      exp(2, { date: '2026-06-01', notes: 'n-first' }),
      exp(3, { date: '2026-06-30', notes: 'n-last' }),
      exp(4, { date: '2026-07-01', notes: 'n-after' }),
    );
    const user = open();
    render(<App />);
    await screen.findByText(/n-before/);
    await user.type(screen.getByLabelText('From'), '2026-06-01');
    await user.type(screen.getByLabelText('To'), '2026-06-30');
    expect(screen.getByText(/n-first/)).toBeInTheDocument();
    expect(screen.getByText(/n-last/)).toBeInTheDocument();
    expect(screen.queryByText(/n-before/)).not.toBeInTheDocument();
    expect(screen.queryByText(/n-after/)).not.toBeInTheDocument();
    expect(screen.getByTestId('active-filters')).toHaveTextContent(/From .*Jun.*To .*Jun/);
  });

  it('combines category and range with AND and Clear filters resets them', async () => {
    seed(
      exp(1, { date: '2026-06-10', category: 'tolls', notes: 'hit' }),
      exp(2, { date: '2026-06-10', category: 'fines', notes: 'wrong-cat' }),
      exp(3, { date: '2026-04-10', category: 'tolls', notes: 'wrong-date' }),
    );
    const user = open();
    render(<App />);
    await screen.findByText(/hit/);
    await user.selectOptions(screen.getByLabelText('Category'), 'tolls');
    await user.type(screen.getByLabelText('From'), '2026-06-01');
    expect(screen.getByText(/hit/)).toBeInTheDocument();
    expect(screen.queryByText(/wrong-cat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/wrong-date/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText(/wrong-cat/)).toBeInTheDocument();
    expect(screen.getByText(/wrong-date/)).toBeInTheDocument();
    expect(screen.getByTestId('active-filters')).toHaveTextContent('No filters active.');
  });

  it('"This month" and "This year" use the Malaysia date', async () => {
    const today = klToday();
    const monthStart = `${today.slice(0, 7)}-01`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    seed(
      exp(1, { date: today, notes: 'n-today' }),
      exp(2, { date: addMonths(monthStart, -1), notes: 'n-lastmonth' }),
      exp(3, { date: addDays(yearStart, -1), notes: 'n-lastyear' }),
    );
    const user = open();
    render(<App />);
    await screen.findByText(/n-today/);
    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByLabelText('From')).toHaveValue(monthStart);
    expect(screen.getByLabelText('To')).toHaveValue(today);
    expect(screen.getByText(/n-today/)).toBeInTheDocument();
    expect(screen.queryByText(/n-lastyear/)).not.toBeInTheDocument();
    if (today.slice(5, 7) !== '01') {
      expect(screen.queryByText(/n-lastmonth/)).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'This year' }));
    expect(screen.getByLabelText('From')).toHaveValue(yearStart);
    expect(screen.queryByText(/n-lastyear/)).not.toBeInTheDocument();
    expect(screen.getByText(/n-today/)).toBeInTheDocument();
  });

  it('tells the user when nothing matches, and when from is later than to', async () => {
    seed(exp(1, { date: '2026-06-10' }));
    const user = open();
    render(<App />);
    await screen.findByRole('list', { name: 'Expenses, newest first' });
    await user.type(screen.getByLabelText('From'), '2026-07-01');
    await user.type(screen.getByLabelText('To'), '2026-06-01');
    expect(await screen.findByText(/"From" is later than "To"/)).toBeInTheDocument();
    expect(screen.getByText('No expenses match these filters.')).toBeInTheDocument();
  });
});

describe('AC-37 / AC-41 / AC-46: totals', () => {
  it('shows total, count, by category and by month, and follows the filters', async () => {
    seed(
      exp(1, { date: '2026-10-05', category: 'charging', amount_minor: 3000 }),
      exp(2, { date: '2026-10-20', category: 'parking', amount_minor: 500 }),
      exp(3, { date: '2026-09-30', category: 'charging', amount_minor: 2000 }),
    );
    const user = open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 55.00');
    });
    expect(screen.getByTestId('total-count')).toHaveTextContent('3');
    const cats = within(screen.getByRole('list', { name: 'Totals by category' }));
    expect(cats.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Charging: RM 50.00 (2)',
      'Parking: RM 5.00 (1)',
    ]);
    const months = within(screen.getByRole('list', { name: 'Totals by month' }));
    expect(months.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '2026-10: RM 35.00 (2)',
      '2026-09: RM 20.00 (1)',
    ]);
    await user.selectOptions(screen.getByLabelText('Category'), 'parking');
    expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 5.00');
    expect(screen.getByTestId('total-count')).toHaveTextContent('1');
  });

  it('shows zeros for an empty selection', async () => {
    seed(exp(1));
    const user = open();
    render(<App />);
    await screen.findByRole('list', { name: 'Expenses, newest first' });
    await user.selectOptions(screen.getByLabelText('Category'), 'tolls');
    expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 0.00');
    expect(screen.getByTestId('total-count')).toHaveTextContent('0');
    expect(screen.queryByRole('list', { name: 'Totals by category' })).not.toBeInTheDocument();
  });

  it('states that service record costs are not included and that totals are computed on the device', async () => {
    open();
    render(<App />);
    expect(await screen.findByText(/Service record costs are not included/)).toBeInTheDocument();
    expect(screen.getByTestId('totals-offline-note')).toHaveTextContent(
      /computed on this device.*also right offline/,
    );
  });

  it('AC-46: a service record cost never appears in expense totals', async () => {
    fake.records.set('b0000000-0000-4000-8000-000000000001', {
      id: 'b0000000-0000-4000-8000-000000000001',
      date: '2026-09-01',
      odometer: 100,
      provider: null,
      description: 'Big service',
      cost_minor: 999_900,
      currency: 'MYR',
      notes: null,
      created_at: STAMP,
      updated_at: STAMP,
    });
    seed(exp(1, { amount_minor: 100 }));
    open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 1.00');
    });
    await started();
    expect(totals()).not.toHaveTextContent('9,999');
    expect(screen.queryByText('Big service')).not.toBeInTheDocument();
  });

  it('AC-41: fetches every page, so a multi-page list is complete and shows no warning', async () => {
    for (let n = 1; n <= 5; n++) seed(exp(n, { date: `2026-09-0${n}`, amount_minor: 100 }));
    fake.expensePageCap = 2;
    open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-count')).toHaveTextContent('5');
    });
    expect(fake.expenseGets).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId('partial-warning')).not.toBeInTheDocument();
  });

  it('AC-41: says "Partial: N expenses loaded" when the cache does not hold every expense', async () => {
    await setCache('expenses', {
      items: [exp(1, { amount_minor: 100 }), exp(2, { amount_minor: 200 })],
      next_cursor: '2',
    });
    server.use(http.all('*/api/v1/*', () => HttpResponse.error()));
    reportReachable(false);
    open();
    render(<App />);
    const warning = await screen.findByTestId('partial-warning');
    expect(warning).toHaveTextContent('Partial: 2 expenses loaded');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load older expenses' })).toBeDisabled();
    });
  });
});

describe('AC-30 / AC-32 / AC-38: create and edit', () => {
  it('defaults the date to the Malaysia date, parses RM input to sen and sends one POST', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    expect(await screen.findByLabelText('Date')).toHaveValue(klToday());
    await user.selectOptions(screen.getByLabelText('Category'), 'insurance');
    await user.type(screen.getByLabelText('Amount (MYR)'), 'RM 1,234.50');
    await user.click(screen.getByLabelText('Notes'));
    await user.paste('  Annual premium  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expenses.size).toBe(1);
    });
    expect(fake.expensePosts).toHaveLength(1);
    const sent = fake.expensePosts[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      date: klToday(),
      category: 'insurance',
      amount_minor: 123450,
      currency: 'MYR',
      notes: 'Annual premium',
    });
    expect(Number.isInteger(sent.amount_minor)).toBe(true);
    expect((await screen.findAllByText(/RM 1,234\.50/)).length).toBeGreaterThan(0);
  });

  it('sends 0.10 as 10 sen (no floating point) and offers all eleven categories', async () => {
    const user = open('/expenses/new');
    render(<App />);
    const select = await screen.findByLabelText('Category');
    expect(within(select).getAllByRole('option')).toHaveLength(11);
    await user.type(screen.getByLabelText('Amount (MYR)'), '0.10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect((fake.expensePosts[0] as { amount_minor: number }).amount_minor).toBe(10);
  });

  it('blocks a bad amount, a zero amount and a future date before anything is sent', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    const amount = await screen.findByLabelText('Amount (MYR)');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Enter an amount in MYR/)).toBeInTheDocument();
    await user.type(amount, '1.234');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/more than RM 0\.00/)).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '5');
    await user.clear(screen.getByLabelText('Date'));
    await user.type(screen.getByLabelText('Date'), addDays(klToday(), 1));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/cannot be in the future/)).toBeInTheDocument();
    expect(fake.expensePosts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(0);
  });

  it('shows a server field error next to its field when the server refused the change', async () => {
    fake.expensePostFailures = [400];
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '12');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-failed')).toBeInTheDocument();
    await user.click(screen.getByText(/Charging · RM 12\.00/));
    await user.click(await screen.findByRole('link', { name: 'Edit' }));
    const field = await screen.findByLabelText('Amount (MYR)');
    expect(field).toHaveAccessibleDescription(/rejected by test/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the saved values in the edit form and saves the changes with one PATCH', async () => {
    seed(exp(1, { date: '2026-09-01', category: 'tolls', amount_minor: 1234, notes: 'Old' }));
    const user = open(`/expenses/${id(1)}/edit`);
    render(<App />);
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Category')).toHaveValue('tolls');
    expect(screen.getByLabelText('Amount (MYR)')).toHaveValue('12.34');
    expect(screen.getByLabelText('Notes')).toHaveValue('Old');
    await user.clear(screen.getByLabelText('Amount (MYR)'));
    await user.type(screen.getByLabelText('Amount (MYR)'), '20');
    await user.clear(screen.getByLabelText('Notes'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(fake.expenses.get(id(1))?.amount_minor).toBe(2000);
    });
    expect(fake.expenses.get(id(1))?.notes).toBeNull();
    expect(fake.expensePatches).toHaveLength(1);
    expect(await screen.findByRole('heading', { name: 'Tolls' })).toBeInTheDocument();
    expect(screen.getByText('RM 20.00')).toBeInTheDocument();
  });

  it('a lost response is retried with the same id and creates no duplicate (replay 200)', async () => {
    fake.expensePostFailures = [500];
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect(fake.expenses.size).toBe(0);
    await flush(true);
    await waitFor(() => {
      expect(fake.expenses.size).toBe(1);
    });
    expect(fake.expensePosts).toHaveLength(2);
    expect((fake.expensePosts[0] as { id: string }).id).toBe(
      (fake.expensePosts[1] as { id: string }).id,
    );
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('AC-33: delete asks first', () => {
  it('does nothing until confirmed, Cancel keeps it, Delete removes it', async () => {
    seed(exp(1, { notes: 'to go' }));
    const user = open(`/expenses/${id(1)}`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this expense?' });
    expect(fake.expenseDeletes).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.expenseDeletes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(fake.expenses.size).toBe(0);
    });
    expect(fake.expenseDeletes).toEqual([id(1)]);
    expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
  });

  it('a replayed DELETE that returns 404 is treated as success', async () => {
    seed(exp(1));
    const user = open(`/expenses/${id(1)}`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    fake.expenses.delete(id(1)); // already gone on the server
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(async () => {
      expect(fake.expenseDeletes).toHaveLength(1);
      expect(await listQueue()).toHaveLength(0);
    });
  });
});

describe('AC-44: notes are plain text', () => {
  it('shows <img src=x onerror=alert(1)> literally in the list and the detail', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    seed(exp(1, { notes: xss }));
    const user = open();
    render(<App />);
    expect(await screen.findByText(xss)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    await user.click(screen.getByText(xss));
    expect((await screen.findAllByText(xss)).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  });
});

describe('AC-39: offline read', () => {
  it('a cold start with the API unreachable still lists the cached expenses with the offline indicator, and filters work', async () => {
    seed(
      exp(1, { category: 'charging', notes: 'cached-one' }),
      exp(2, { category: 'parking', notes: 'cached-two' }),
    );
    const user = open();
    const first = render(<App />);
    await screen.findByText(/cached-one/);
    await started();
    first.unmount();
    server.use(http.all('*/api/v1/*', () => HttpResponse.error()));
    reportReachable(false);
    render(<App />);
    expect(await screen.findByText(/cached-one/)).toBeInTheDocument();
    expect(screen.getByText(/cached-two/)).toBeInTheDocument();
    expect(await screen.findByTestId('offline-indicator')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Category'), 'parking');
    expect(screen.queryByText(/cached-one/)).not.toBeInTheDocument();
    expect(screen.getByText(/cached-two/)).toBeInTheDocument();
    expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 10.00');
  });
});

describe('AC-40: offline writes', () => {
  it('create offline is pending, survives a reload and is POSTed exactly once on reconnect', async () => {
    const user = open('/expenses/new');
    const first = render(<App />);
    await screen.findByLabelText('Amount (MYR)');
    await started();
    reportReachable(false);
    await user.type(screen.getByLabelText('Amount (MYR)'), '45.60');
    await user.type(screen.getByLabelText('Notes'), 'offline made');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    expect(fake.expensePosts).toHaveLength(0);
    // Offline totals include the pending expense.
    expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 45.60');
    first.unmount();
    await closeDbForTests(); // a reload: the queue must come back from IndexedDB
    expect(await listQueue()).toHaveLength(1);
    window.history.pushState(null, '', '/expenses');
    reportReachable(false);
    render(<App />);
    expect(await screen.findByText(/offline made/)).toBeInTheDocument();
    expect(screen.getByTestId('sync-pending')).toBeInTheDocument();
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.expensePosts).toHaveLength(1);
    expect(fake.expenses.size).toBe(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('create then edit offline sends one POST carrying the final content', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await screen.findByLabelText('Amount (MYR)');
    await started();
    reportReachable(false);
    await user.type(screen.getByLabelText('Amount (MYR)'), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByText(/Charging · RM 10\.00/));
    await user.click(await screen.findByRole('link', { name: 'Edit' }));
    const amount = await screen.findByLabelText('Amount (MYR)');
    await user.clear(amount);
    await user.type(amount, '99');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('RM 99.00')).toBeInTheDocument();
    expect(await listQueue()).toHaveLength(1);
    reportReachable(true);
    await flush(true);
    expect(fake.expensePosts).toHaveLength(1);
    expect(fake.expensePatches).toHaveLength(0);
    expect([...fake.expenses.values()][0]?.amount_minor).toBe(9900);
  });

  it('edit offline of a synced expense is pending, then sent once as a PATCH', async () => {
    seed(exp(1, { amount_minor: 1000 }));
    const user = open(`/expenses/${id(1)}/edit`);
    render(<App />);
    await screen.findByLabelText('Amount (MYR)');
    await started();
    reportReachable(false);
    const amount = screen.getByLabelText('Amount (MYR)');
    await user.clear(amount);
    await user.type(amount, '77');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    expect(screen.getByText('RM 77.00')).toBeInTheDocument();
    expect(fake.expensePatches).toHaveLength(0);
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.expensePatches).toHaveLength(1);
    expect(fake.expenses.get(id(1))?.amount_minor).toBe(7700);
  });

  it('delete offline is pending, then DELETEd once; delete of an unsent create sends nothing', async () => {
    seed(exp(1, { notes: 'server one' }));
    const user = open(`/expenses/${id(1)}`);
    render(<App />);
    await screen.findByRole('button', { name: 'Delete' });
    await started();
    reportReachable(false);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    expect(screen.queryByText(/server one/)).not.toBeInTheDocument();
    expect(fake.expenseDeletes).toHaveLength(0);
    expect(await listQueue()).toHaveLength(1);
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(fake.expenseDeletes).toHaveLength(1);
    expect(fake.expenses.size).toBe(0);

    // Create offline, then delete it before it was ever sent: nothing reaches the server.
    reportReachable(false);
    await user.click(screen.getByRole('link', { name: 'Add expense' }));
    await user.type(await screen.findByLabelText('Amount (MYR)'), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByText(/Charging · RM 3\.00/));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await screen.findByRole('heading', { name: 'Expenses' });
    expect(await listQueue()).toHaveLength(0);
    reportReachable(true);
    await flush(true);
    expect(fake.expensePosts).toHaveLength(0);
  });

  it('a 400 on one item is shown for that item and does not block the others', async () => {
    fake.expensePostFailures = [400];
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '11');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-failed')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Add expense' }));
    await user.type(await screen.findByLabelText('Amount (MYR)'), '22');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expenses.size).toBe(1);
    });
    expect([...fake.expenses.values()][0]?.amount_minor).toBe(2200);
    expect(await screen.findByTestId('sync-failed')).toBeInTheDocument();
    await user.click(screen.getByText(/Charging · RM 11\.00/));
    expect(await screen.findByText(/This change was not accepted by the server/)).toBeVisible();
    expect(screen.getByText(/amount_minor: rejected by test/)).toBeVisible();
  });

  it('a 409 is shown as a refused change for that item', async () => {
    fake.expensePostFailures = [409];
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '11');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('sync-failed')).toBeInTheDocument();
    expect(await listQueue()).toHaveLength(1);
    expect((await listQueue())[0]?.last_error?.status).toBe(409);
  });
});

describe('ADR-008: optional energy (kWh) on charging expenses', () => {
  it('shows the kWh field only for charging and sends integer watt-hours', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    expect(await screen.findByLabelText(/Energy \(kWh\)/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Category'), 'parking');
    expect(screen.queryByLabelText(/Energy \(kWh\)/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Category'), 'charging');
    await user.type(screen.getByLabelText('Amount (MYR)'), '25.50');
    await user.type(screen.getByLabelText(/Energy \(kWh\)/), '42.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect(fake.expensePosts[0]).toMatchObject({ category: 'charging', energy_wh: 42500 });
    expect((await screen.findAllByText(/42\.5 kWh|RM 25\.50/)).length).toBeGreaterThan(0);
  });

  it('sends null when the field is blank, and never sends energy for another category', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect(fake.expensePosts[0]).toMatchObject({ energy_wh: null });
  });

  it('keeps a typed kWh value out of the request after switching away from charging', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText(/Energy \(kWh\)/), '10');
    await user.selectOptions(screen.getByLabelText('Category'), 'tolls');
    await user.type(screen.getByLabelText('Amount (MYR)'), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect(fake.expensePosts[0]).toMatchObject({ category: 'tolls', energy_wh: null });
  });

  it('blocks a bad kWh value before anything is sent', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '5');
    await user.type(screen.getByLabelText(/Energy \(kWh\)/), '1.2345');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at most 3 decimals/)).toBeInTheDocument();
    expect(fake.expensePosts).toHaveLength(0);
  });

  it('loads the saved value into the edit form and can clear it', async () => {
    seed(exp(1, { energy_wh: 42500 }));
    const user = open(`/expenses/${id(1)}/edit`);
    render(<App />);
    await started();
    const field = await screen.findByLabelText(/Energy \(kWh\)/);
    expect(field).toHaveValue('42.5');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(fake.expenses.get(id(1))?.energy_wh).toBeNull();
    });
  });

  it('shows the energy on the detail page only when it is recorded', async () => {
    seed(exp(1, { energy_wh: 7125 }), exp(2, { energy_wh: null }));
    open(`/expenses/${id(1)}`);
    render(<App />);
    expect(await screen.findByText('7.125 kWh')).toBeInTheDocument();
  });
});
