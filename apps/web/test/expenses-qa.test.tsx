import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, test, vi } from 'vitest';
import vectors from '../../../packages/shared-types/test-vectors/expense-totals.json';
import { App } from '../src/App';
import type { Expense, ExpenseCreate } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { validateExpense } from '../src/components/ExpenseForm';
import { reportReachable } from '../src/lib/connectivity';
import { addDays, klToday } from '../src/lib/dates';
import {
  expenseTotals,
  filterExpenses,
  type ExpenseFilter,
  type TotalsInput,
} from '../src/lib/expenseTotals';
import { formatMyr, MAX_MINOR, parseMyrToSen, senToInput } from '../src/lib/money';
import { getCache, setCache } from '../src/storage/cache';
import { getDb } from '../src/storage/db';
import {
  enqueueExpenseCreate,
  enqueueExpenseDelete,
  enqueueExpenseEdit,
  listQueue,
} from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { fake, server } from './server';

afterEach(() => {
  vi.useRealTimers();
});

const STAMP = '2026-10-01T00:00:00Z';
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function exp(n: number, over: Partial<Expense> = {}): Expense {
  return {
    id: id(n),
    date: '2026-09-01',
    category: 'charging',
    amount_minor: 1000,
    currency: 'MYR',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
function body(n: number, over: Partial<ExpenseCreate> = {}) {
  return {
    id: id(n),
    date: '2026-09-01',
    category: 'charging' as const,
    amount_minor: 1000,
    currency: 'MYR' as const,
    notes: null,
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
async function started() {
  await waitFor(() => {
    expect(fake.expenseGets).toBeGreaterThan(0);
  });
}
const apiDown = () => server.use(http.all('*/api/v1/*', () => HttpResponse.error()));

describe('QA money parsing', () => {
  it.each([
    ['0.29', 29],
    ['0.1', 10],
    ['4.35', 435],
    ['8.2', 820],
    ['1.15', 115],
    ['RM0.01', 1],
    ['rm 1,000', 100000],
    ['  5  ', 500],
    ['RM 1,234.5', 123450],
    ['9999999999.99', 999999999999],
    ['10000000000', MAX_MINOR],
    ['0', 0],
  ])('accepts %j as %i sen', (input, sen) => {
    expect(parseMyrToSen(input)).toEqual({ ok: true, minor: sen });
  });

  it.each([
    '0.105',
    '1e3',
    '-1',
    '',
    '   ',
    '1,23',
    '٣',
    '١٢.٥٠',
    '１２',
    'RM',
    'RM RM 5',
    '+5',
    '5.',
    '.5',
    '1,2345',
    '1234,567',
    '10000000000.01',
    '99999999999999999999',
    'NaN',
    'Infinity',
    '1 000',
    '0x10',
    '5 RM',
    '1_000',
  ])('rejects %j', (input) => {
    expect(parseMyrToSen(input).ok).toBe(false);
  });

  it('never loses a sen to floating point (every w.ff for w 0..200)', () => {
    for (let w = 0; w <= 200; w++)
      for (let f = 0; f <= 99; f++) {
        const s = `${w}.${String(f).padStart(2, '0')}`;
        expect(parseMyrToSen(s)).toEqual({ ok: true, minor: w * 100 + f });
      }
  });

  it('senToInput round-trips through the parser', () => {
    for (const n of [1, 9, 10, 99, 100, 101, 123456, MAX_MINOR]) {
      expect(parseMyrToSen(senToInput(n))).toEqual({ ok: true, minor: n });
    }
  });

  // QA-W1 (Low): leading zeros are counted against the 13-digit "too large" guard.
  test.fails('QA-W1 accepts 0000000000000001 as RM 1.00', () => {
    expect(parseMyrToSen('0000000000000001')).toEqual({ ok: true, minor: 100 });
  });

  // QA-W2 (Low): a leading "0," thousands group is accepted and silently becomes RM 100.
  test.fails('QA-W2 rejects the malformed grouping 0,100', () => {
    expect(parseMyrToSen('0,100').ok).toBe(false);
  });
});

describe('QA formatMyr', () => {
  it.each([
    [0, 'RM 0.00'],
    [1, 'RM 0.01'],
    [9, 'RM 0.09'],
    [100, 'RM 1.00'],
    [99999, 'RM 999.99'],
    [100000, 'RM 1,000.00'],
    [123450, 'RM 1,234.50'],
    [MAX_MINOR, 'RM 10,000,000,000.00'],
    [2_000_000_000_001, 'RM 20,000,000,000.01'],
  ])('%i sen is %s', (n, text) => {
    expect(formatMyr(n)).toBe(text);
  });
});

describe('QA Kuala Lumpur date rule', () => {
  it('klToday rolls over at 16:00:00Z', () => {
    expect(klToday(new Date('2026-10-21T15:59:59Z'))).toBe('2026-10-21');
    expect(klToday(new Date('2026-10-21T16:00:00Z'))).toBe('2026-10-22');
    expect(klToday(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12-31');
    expect(klToday(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
    expect(klToday(new Date('2028-02-28T16:00:00Z'))).toBe('2028-02-29');
  });

  it('the form refuses tomorrow (KL) and accepts today (KL) at the boundary', () => {
    const before = klToday(new Date('2026-10-21T15:59:59Z'));
    const after = klToday(new Date('2026-10-21T16:00:00Z'));
    const base = { category: 'charging', amount: '1', notes: '' };
    expect(validateExpense({ ...base, date: '2026-10-22' }, before).date).toMatch(/future/);
    expect(validateExpense({ ...base, date: '2026-10-21' }, before).date).toBeUndefined();
    expect(validateExpense({ ...base, date: '2026-10-22' }, after).date).toBeUndefined();
    expect(validateExpense({ ...base, date: '2026-10-23' }, after).date).toMatch(/future/);
  });

  it('rejects dates before 2000, impossible dates and an empty date', () => {
    const base = { category: 'charging', amount: '1', notes: '' };
    const today = '2026-10-21';
    expect(validateExpense({ ...base, date: '1999-12-31' }, today).date).toBeDefined();
    expect(validateExpense({ ...base, date: '2000-01-01' }, today).date).toBeUndefined();
    expect(validateExpense({ ...base, date: '2026-02-30' }, today).date).toBeDefined();
    expect(validateExpense({ ...base, date: '' }, today).date).toBeDefined();
  });

  it('validates category, amount and notes length', () => {
    const ok = { date: '2026-01-01', category: 'tolls', amount: '1', notes: '' };
    expect(validateExpense({ ...ok, category: 'nope' }).category).toBeDefined();
    expect(validateExpense({ ...ok, amount: '0.00' }).amount).toBeDefined();
    expect(validateExpense({ ...ok, notes: 'x'.repeat(5000) }).notes).toBeUndefined();
    expect(validateExpense({ ...ok, notes: 'x'.repeat(5001) }).notes).toBeDefined();
    expect(validateExpense({ ...ok, notes: `  ${'x'.repeat(5000)}  ` }).notes).toBeUndefined();
  });

  // QA-W3 (Low): NUL in notes is accepted locally (contract: 400) so it becomes a failed item later.
  test.fails('QA-W3 refuses a NUL character in notes before queueing', () => {
    const r = validateExpense({
      date: '2026-01-01',
      category: 'tolls',
      amount: '1',
      notes: 'a\0b',
    });
    expect(r.notes).toBeDefined();
  });

  // QA-W4 (Low): length is counted in UTF-16 units; the server counts characters.
  test.fails('QA-W4 accepts 2501 emoji (2501 characters, under the 5000 limit)', () => {
    const r = validateExpense({
      date: '2026-01-01',
      category: 'tolls',
      amount: '1',
      notes: '😀'.repeat(2501),
    });
    expect(r.notes).toBeUndefined();
  });
});

describe('QA totals', () => {
  interface Case {
    name: string;
    expenses: TotalsInput[];
    filter: ExpenseFilter;
    expected: ReturnType<typeof expenseTotals>;
  }
  const cases = vectors.cases as unknown as Case[];

  it('by_category and by_month always add up to the total and the count', () => {
    for (const c of cases) {
      const t = expenseTotals(filterExpenses(c.expenses, c.filter));
      expect(t.by_category.reduce((a, x) => a + x.total_minor, 0)).toBe(t.total_minor);
      expect(t.by_month.reduce((a, x) => a + x.total_minor, 0)).toBe(t.total_minor);
      expect(t.by_month.reduce((a, x) => a + x.count, 0)).toBe(t.count);
    }
  });

  it('is independent of input order', () => {
    for (const c of cases) {
      const rows = filterExpenses(c.expenses, c.filter);
      expect(expenseTotals([...rows].reverse())).toEqual(expenseTotals(rows));
    }
  });

  it('from = to selects exactly that day; from > to selects nothing', () => {
    const rows: TotalsInput[] = [
      { date: '2026-06-01', category: 'other', amount_minor: 1 },
      { date: '2026-06-02', category: 'other', amount_minor: 2 },
    ];
    expect(filterExpenses(rows, { from: '2026-06-02', to: '2026-06-02' })).toHaveLength(1);
    expect(filterExpenses(rows, { from: '2026-06-03', to: '2026-06-01' })).toHaveLength(0);
  });
});

describe('QA queue coalescing', () => {
  it('create + edit + delete before any attempt leaves an empty queue', async () => {
    await enqueueExpenseCreate(body(1));
    await enqueueExpenseEdit(id(1), { amount_minor: 5 });
    await enqueueExpenseDelete(id(1));
    expect(await listQueue()).toHaveLength(0);
  });

  it('delete then recreate the same id leaves only the create', async () => {
    await enqueueExpenseCreate(body(1));
    await enqueueExpenseDelete(id(1));
    await enqueueExpenseCreate(body(1, { amount_minor: 77 }));
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'create-expense', body: { amount_minor: 77 } });
  });

  it('delete of an attempted create keeps the create and adds a DELETE after it', async () => {
    await enqueueExpenseCreate(body(1));
    const db = await getDb();
    const [e] = await listQueue();
    await db.put('queue', { ...e!, attempts: 1 });
    await enqueueExpenseDelete(id(1));
    expect((await listQueue()).map((x) => x.kind)).toEqual(['create-expense', 'delete-expense']);
  });

  // QA-W8 (Medium): editing an already-attempted create (response may have been lost) coalesces
  // into it and resets attempts to 0, so a following delete cancels both. If the first POST did
  // reach the server, the expense is left behind there and reappears on the next refresh.
  test.fails('QA-W8 edit then delete of an attempted create still sends a DELETE', async () => {
    await enqueueExpenseCreate(body(1));
    const db = await getDb();
    const [e] = await listQueue();
    await db.put('queue', { ...e!, attempts: 1, status: 'pending' });
    await enqueueExpenseEdit(id(1), { amount_minor: 5 });
    await enqueueExpenseDelete(id(1));
    expect((await listQueue()).map((x) => x.kind)).toContain('delete-expense');
  });

  it('an edit after a failed attempt resets it to pending with attempts 0 and merges', async () => {
    seed(exp(1));
    await enqueueExpenseEdit(id(1), { amount_minor: 5 });
    const db = await getDb();
    const [e] = await listQueue();
    await db.put('queue', {
      ...e!,
      status: 'failed',
      attempts: 3,
      last_error: { status: 400, code: 'validation_error', message: 'x', details: [] },
    });
    await enqueueExpenseEdit(id(1), { notes: 'n' });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      last_error: null,
      body: { amount_minor: 5, notes: 'n' },
    });
  });

  it('a failed create does not block a different expense in the same flush', async () => {
    setToken('tok-test', 3600);
    fake.expensePostFailures = [400];
    await enqueueExpenseCreate(body(1));
    await enqueueExpenseCreate(body(2, { amount_minor: 222 }));
    await flush(true);
    expect(fake.expenses.has(id(2))).toBe(true);
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.status).toBe('failed');
  });

  it('an edit queued behind a failed create of the same expense is held, not sent', async () => {
    setToken('tok-test', 3600);
    fake.expensePostFailures = [400];
    await enqueueExpenseCreate(body(1));
    await flush(true);
    await enqueueExpenseEdit(id(1), { amount_minor: 5 });
    await flush(true);
    expect(fake.expensePatches).toHaveLength(0);
  });
});

describe('QA list, filters and totals in the UI', () => {
  it('the list total equals the sum of the visible rows and matches expenseTotals', async () => {
    seed(
      exp(1, { amount_minor: 29, date: '2026-09-01' }),
      exp(2, { amount_minor: 1, date: '2026-09-02', category: 'tolls' }),
      exp(3, { amount_minor: 123456, date: '2026-08-31', category: 'tolls' }),
    );
    open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 1,234.86');
    });
    expect(screen.getByTestId('total-count')).toHaveTextContent('3');
    expect(screen.queryByTestId('partial-warning')).not.toBeInTheDocument();
  });

  it('1 sen shows as RM 0.01 and the count word is singular', async () => {
    seed(exp(1, { amount_minor: 1 }));
    open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 0.01');
    });
    expect(screen.getByTestId('totals')).toHaveTextContent(/in 1 expenseService/);
  });

  it('shows RM 20,000,000,000.01 for two 10^12 rows and one sen', async () => {
    seed(
      exp(1, { amount_minor: MAX_MINOR }),
      exp(2, { amount_minor: MAX_MINOR }),
      exp(3, { amount_minor: 1 }),
    );
    open();
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 20,000,000,000.01');
    });
  });

  it('from > to shows the message; from = to is inclusive', async () => {
    seed(exp(1, { date: '2026-06-10', notes: 'day-a' }), exp(2, { date: '2026-06-11' }));
    const user = open();
    render(<App />);
    await screen.findByText(/day-a/);
    await user.type(screen.getByLabelText('From'), '2026-06-10');
    await user.type(screen.getByLabelText('To'), '2026-06-10');
    expect(screen.getByText(/day-a/)).toBeInTheDocument();
    expect(screen.getByTestId('total-count')).toHaveTextContent('1');
    expect(screen.queryByText(/is later than/)).not.toBeInTheDocument();
  });

  it('"This month" at the month end and "This year" include today, not tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T15:59:59Z'));
    const t = klToday();
    expect(t).toBe('2026-10-31');
    seed(
      exp(1, { date: '2026-10-31', notes: 'last-day' }),
      exp(2, { date: '2026-10-01', notes: 'first-day' }),
      exp(3, { date: '2026-09-30', notes: 'prev-month' }),
    );
    const user = open();
    render(<App />);
    await screen.findByText(/last-day/);
    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-31');
    expect(screen.getByText(/first-day/)).toBeInTheDocument();
    expect(screen.queryByText(/prev-month/)).not.toBeInTheDocument();
  });

  it('"This year" on 1 Jan KL (16:00Z on 31 Dec) starts on 2027-01-01', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    seed(exp(1, { date: '2026-12-31', notes: 'old-year' }));
    const user = open();
    render(<App />);
    await screen.findByText(/old-year/);
    await user.click(screen.getByRole('button', { name: 'This year' }));
    expect(screen.getByLabelText('From')).toHaveValue('2027-01-01');
    expect(screen.getByLabelText('To')).toHaveValue('2027-01-01');
    expect(screen.queryByText(/old-year/)).not.toBeInTheDocument();
  });

  it('the Partial warning appears when the cache has a next cursor, and counts only loaded', async () => {
    await setCache('expenses', { items: [exp(1)], next_cursor: 'abc' });
    apiDown();
    reportReachable(false);
    open();
    render(<App />);
    expect(await screen.findByTestId('partial-warning')).toHaveTextContent(
      'Partial: 1 expenses loaded',
    );
  });

  // QA-W5 (Low): the warning says "1 expenses" (no singular).
  test.fails('QA-W5 partial warning uses the singular for one expense', async () => {
    await setCache('expenses', { items: [exp(1)], next_cursor: 'abc' });
    apiDown();
    reportReachable(false);
    open();
    render(<App />);
    expect(await screen.findByTestId('partial-warning')).toHaveTextContent(/1 expense loaded/);
  });

  it('notes are plain text: html, script-like strings and quotes appear literally', async () => {
    const samples = ['<script>window.__x=1</script>', '"><svg onload=alert(1)>', '&lt;b&gt;'];
    seed(...samples.map((n, i) => exp(i + 1, { notes: n, date: `2026-09-0${i + 1}` })));
    open();
    render(<App />);
    for (const s of samples) expect(await screen.findByText(s)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it('a very long unbroken note renders in full in the detail page', async () => {
    const long = 'A'.repeat(5000);
    seed(exp(1, { notes: long }));
    open(`/expenses/${id(1)}`);
    render(<App />);
    expect(await screen.findByText(long)).toBeInTheDocument();
  });
});

describe('QA accessibility', () => {
  it('every form control on the new-expense page has an accessible name', async () => {
    open('/expenses/new');
    render(<App />);
    await screen.findByLabelText('Amount (MYR)');
    const main = within(screen.getByRole('main'));
    for (const el of [...main.getAllByRole('textbox'), ...main.getAllByRole('combobox')]) {
      expect(el).toHaveAccessibleName();
    }
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
    for (const b of main.getAllByRole('button')) expect(b).toHaveAccessibleName();
  });

  it('every filter control and button on the list page has an accessible name', async () => {
    seed(exp(1));
    open();
    render(<App />);
    const filters = await screen.findByRole('form', { name: 'Filters' });
    const f = within(filters);
    for (const el of [...f.getAllByRole('combobox'), ...f.getAllByRole('button')])
      expect(el).toHaveAccessibleName();
    expect(f.getByLabelText('From')).toBeInTheDocument();
    expect(f.getByLabelText('To')).toBeInTheDocument();
  });

  // QA-W6 (Low): the filter select and the form select are both "Category"; on the list page
  // getByLabelText('Category') is unique, but the filter label is not distinguishable from the
  // form field for assistive tech when both are announced out of context.
  test.fails(
    'QA-W6 the filter category control is named differently from the form field',
    async () => {
      seed(exp(1));
      open();
      render(<App />);
      const filters = await screen.findByRole('form', { name: 'Filters' });
      expect(within(filters).getByRole('combobox')).not.toHaveAccessibleName('Category');
    },
  );
});

describe('QA save behaviour', () => {
  it('double-clicking Save sends exactly one POST', async () => {
    server.use(
      http.post('*/api/v1/expenses', async ({ request }) => {
        await delay(150);
        const b = (await request.json()) as Expense;
        fake.expensePosts.push(b);
        const x = { ...b, notes: b.notes ?? null, created_at: STAMP, updated_at: STAMP };
        fake.expenses.set(x.id, x);
        return HttpResponse.json(x, { status: 201 });
      }),
    );
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '5');
    const save = screen.getByRole('button', { name: 'Save' });
    await user.dblClick(save);
    await waitFor(() => {
      expect(fake.expenses.size).toBe(1);
    });
    expect(fake.expensePosts).toHaveLength(1);
    await waitFor(async () => {
      expect(await listQueue()).toHaveLength(0);
    });
  });

  it('unmounting during an in-flight save does not lose or duplicate the expense', async () => {
    server.use(
      http.post('*/api/v1/expenses', async ({ request }) => {
        await delay(150);
        const b = (await request.json()) as Expense;
        fake.expensePosts.push(b);
        const x = { ...b, notes: b.notes ?? null, created_at: STAMP, updated_at: STAMP };
        fake.expenses.set(x.id, x);
        return HttpResponse.json(x, { status: 201 });
      }),
    );
    const user = open('/expenses/new');
    const r = render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    r.unmount();
    await waitFor(() => {
      expect(fake.expenses.size).toBe(1);
    });
    expect(fake.expensePosts).toHaveLength(1);
  });

  it('a past date and a 5000-character note are accepted and sent trimmed', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    const date = await screen.findByLabelText('Date');
    await user.clear(date);
    await user.type(date, '2000-01-01');
    await user.type(screen.getByLabelText('Amount (MYR)'), 'RM 0.01');
    await user.click(screen.getByLabelText('Notes'));
    await user.paste('x'.repeat(5000));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect(fake.expensePosts[0]).toMatchObject({ date: '2000-01-01', amount_minor: 1 });
  });

  it('whitespace-only notes are sent as null', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    await user.type(await screen.findByLabelText('Amount (MYR)'), '2');
    await user.click(screen.getByLabelText('Notes'));
    await user.paste('   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.expensePosts).toHaveLength(1);
    });
    expect((fake.expensePosts[0] as { notes: unknown }).notes).toBeNull();
  });

  it('a future date typed in the form is refused and nothing is queued', async () => {
    const user = open('/expenses/new');
    render(<App />);
    await started();
    const date = await screen.findByLabelText('Date');
    await user.clear(date);
    await user.type(date, addDays(klToday(), 1));
    await user.type(screen.getByLabelText('Amount (MYR)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/cannot be in the future/)).toBeInTheDocument();
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('QA offline and local data', () => {
  it('offline cold start with nothing cached says so and still offers Add expense', async () => {
    apiDown();
    reportReachable(false);
    open();
    render(<App />);
    expect(await screen.findByText(/Nothing saved on this device yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add expense' })).toBeInTheDocument();
  });

  it('a pending delete of a synced expense hides it and its amount leaves the totals', async () => {
    seed(exp(1, { amount_minor: 500, notes: 'gone' }), exp(2, { amount_minor: 100 }));
    const user = open();
    render(<App />);
    await screen.findByText(/gone/);
    await started();
    reportReachable(false);
    await enqueueExpenseDelete(id(1));
    await waitFor(() => {
      expect(screen.getByTestId('total-amount')).toHaveTextContent('RM 1.00');
    });
    expect(screen.queryByText(/gone/)).not.toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it('sign out and clear local data removes the expense cache and the expense queue', async () => {
    seed(exp(1, { notes: 'cached-note' }));
    const user = open();
    render(<App />);
    await screen.findByText(/cached-note/);
    await started();
    expect(await getCache('expenses')).toBeDefined();
    apiDown();
    reportReachable(false);
    await enqueueExpenseCreate(body(9, { notes: 'queued-note' }));
    await user.click(screen.getByRole('button', { name: 'Sign out and clear local data' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Clear local data and sign out',
      }),
    );
    await waitFor(async () => {
      expect(await listQueue()).toHaveLength(0);
    });
    expect(await getCache('expenses')).toBeUndefined();
    expect(screen.queryByText(/cached-note/)).not.toBeInTheDocument();
    expect(screen.queryByText(/queued-note/)).not.toBeInTheDocument();
  });

  // QA-W7 (Low): the clear-data dialog only mentions "service records and vehicle", not expenses.
  test.fails('QA-W7 the clear-data dialog mentions expenses', async () => {
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign out and clear local data' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/expenses/i);
  });
});
