import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { RecordForm } from '../src/components/RecordForm';
import { SignIn } from '../src/components/SignIn';
import { ApiError } from '../src/api/client';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import { err, fake, server } from './server';

describe('SignIn', () => {
  it('signs in and never stores the password', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(fake.tokenIssued).toBe('tok-test');
    });
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('correct-horse');
  });

  it('shows a clear message for 429 using Retry-After', async () => {
    server.use(
      http.post('*/api/v1/auth/token', () =>
        err(429, 'rate_limited', 'Too many', [], { 'Retry-After': '600' }),
      ),
    );
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 10 minutes.',
    );
  });

  it('rounds Retry-After up to whole minutes', async () => {
    server.use(
      http.post('*/api/v1/auth/token', () =>
        err(429, 'rate_limited', 'Too many', [], { 'Retry-After': '61' }),
      ),
    );
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 minutes');
  });

  it('says wrong password on 401', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
  });
});

describe('RecordForm', () => {
  it('sends cost as integer sen and odometer as an integer', async () => {
    const user = userEvent.setup();
    let got: unknown;
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={(v) => {
          got = v;
          return Promise.resolve();
        }}
      />,
    );
    await user.clear(screen.getByLabelText('Date'));
    await user.type(screen.getByLabelText('Date'), '2026-10-01');
    await user.type(screen.getByLabelText('Odometer (km)'), '12345');
    await user.type(screen.getByLabelText('Description'), 'Brake fluid');
    await user.type(screen.getByLabelText('Cost (MYR)'), '120.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(got).toEqual({
      date: '2026-10-01',
      odometer: 12345,
      provider: null,
      description: 'Brake fluid',
      cost_minor: 12050,
      notes: null,
    });
  });

  it('validates fields with accessible errors and does not submit', async () => {
    const user = userEvent.setup();
    let called = false;
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() => {
          called = true;
          return Promise.resolve();
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(called).toBe(false);
    const cost = screen.getByLabelText('Cost (MYR)');
    expect(cost).toHaveAttribute('aria-invalid', 'true');
    expect(cost).toHaveAccessibleDescription(/amount in MYR/);
  });

  it('shows a server "future date" rejection next to the date field, with no UTC explanation', async () => {
    const user = userEvent.setup();
    render(
      <RecordForm
        submitLabel="Save"
        onCancel={() => undefined}
        onSubmit={() =>
          Promise.reject(
            new ApiError(400, 'validation_error', 'Request failed validation.', [
              { field: 'date', issue: 'must not be in the future' },
            ]),
          )
        }
      />,
    );
    await user.type(screen.getByLabelText('Odometer (km)'), '1');
    await user.type(screen.getByLabelText('Description'), 'x');
    await user.type(screen.getByLabelText('Cost (MYR)'), '1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const date = screen.getByLabelText('Date');
    await waitFor(() => {
      expect(date).toHaveAttribute('aria-invalid', 'true');
    });
    expect(date).toHaveAccessibleDescription(/must not be in the future/);
    expect(document.getElementById('date-explain')).toBeNull();
    expect(screen.queryByText(/Between 00:00 and 08:00/)).not.toBeInTheDocument();
  });
});

describe('App flows', () => {
  function signedInApp() {
    setToken('tok-test', 3600);
    render(<App />);
  }

  it('shows the offline indicator and cached records when the server is unreachable', async () => {
    fake.records.set('44444444-4444-4444-8444-444444444444', {
      id: '44444444-4444-4444-8444-444444444444',
      date: '2026-09-01',
      odometer: 100,
      provider: null,
      description: 'First service',
      cost_minor: 10000,
      currency: 'MYR',
      notes: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    });
    signedInApp();
    expect(await screen.findByText('First service')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    reportReachable(false);
    expect(await screen.findByTestId('offline-indicator')).toBeInTheDocument();
    expect(screen.getByText('First service')).toBeInTheDocument();
  });

  it('delete asks for confirmation before anything is sent', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    fake.records.set(id, {
      id,
      date: '2026-09-01',
      odometer: 1,
      provider: null,
      description: 'To delete',
      cost_minor: 100,
      currency: 'MYR',
      notes: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    });
    const user = userEvent.setup();
    signedInApp();
    await user.click(await screen.findByRole('link', { name: /To delete/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(fake.deletes).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fake.deletes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => {
      expect(fake.deletes).toEqual([id]);
    });
    await waitFor(() => {
      expect(screen.queryByText('To delete')).not.toBeInTheDocument();
    });
  });

  it('creating a record while offline shows Pending in the list', async () => {
    const user = userEvent.setup();
    signedInApp();
    reportReachable(false);
    await user.click(await screen.findByRole('link', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Odometer (km)'), '2000');
    await user.type(screen.getByLabelText('Description'), 'Offline entry');
    await user.type(screen.getByLabelText('Cost (MYR)'), '55');
    await user.clear(screen.getByLabelText('Date'));
    await user.type(screen.getByLabelText('Date'), '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('link', { name: /Offline entry/ })).toBeInTheDocument();
    expect(await screen.findByTestId('sync-pending')).toBeInTheDocument();
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1 waiting to sync');
    expect(fake.posts).toHaveLength(0);
  });
});
