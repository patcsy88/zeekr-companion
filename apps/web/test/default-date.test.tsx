import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { RecordForm } from '../src/components/RecordForm';
import { klToday } from '../src/lib/dates';
import { fake } from './server';

afterEach(() => {
  vi.useRealTimers();
});

// 2026-10-11 19:00 UTC is 2026-10-12 03:00 in Malaysia (UTC+8; the tests run with TZ=Asia/Kuala_Lumpur).
const AT_03_MYT = new Date('2026-10-11T19:00:00Z');

describe('owner decision 2026-10-22: the default date is the Asia/Kuala_Lumpur date', () => {
  it('the test clock is the next day in Malaysia than in UTC (guards the setup)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT_03_MYT);
    expect(klToday()).toBe('2026-10-12');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-11'); // UTC
  });

  it('the new-record form defaults to the Malaysian date at 03:00 MYT', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT_03_MYT);
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => Promise.resolve()}
      />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-12');
  });

  it('saving the untouched default is accepted by the Malaysian-date rule and shows no failed item', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT_03_MYT);
    fake.klDateRule = true;
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Odometer (km)'), '100');
    await user.type(screen.getByLabelText('Description'), 'Default date');
    await user.type(screen.getByLabelText('Cost (MYR)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.records.size).toBe(1);
    });
    expect([...fake.records.values()][0]?.date).toBe('2026-10-12');
    const list = await screen.findByRole('list', { name: /Service records/ });
    expect(within(list).queryByTestId('sync-failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('failed-count')).not.toBeInTheDocument();
  });

  it('shows a hint under the date field about the Malaysian default date', () => {
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => Promise.resolve()}
      />,
    );
    const hint = screen.getByTestId('date-default-hint');
    expect(hint).toHaveTextContent(/today's date in Malaysia/i);
    expect(hint).not.toHaveTextContent(/UTC|00:00|08:00/);
    expect(screen.getByLabelText('Date')).toHaveAccessibleDescription(/today's date in Malaysia/i);
  });

  it('an existing record keeps its stored date, even when it differs from today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT_03_MYT);
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => Promise.resolve()}
        initial={{
          id: '11111111-1111-4111-8111-111111111111',
          date: '2026-10-12',
          odometer: 1,
          provider: null,
          description: 'Stored',
          cost_minor: 1,
          currency: 'MYR',
          notes: null,
          created_at: '2026-10-11T00:00:00Z',
          updated_at: '2026-10-11T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-12');
  });
});
