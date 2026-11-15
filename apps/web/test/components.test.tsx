import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
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
    await user.type(screen.getByLabelText('Username'), 'owner');
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
    await user.type(screen.getByLabelText('Username'), 'owner');
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
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 minutes');
  });

  it('says wrong username or password on 401', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username, password or code.');
  });

  it('always shows a Code field and leaves it out of the request when empty', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/api/v1/auth/token', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ access_token: 'tok-test', expires_in: 3600 });
      }),
    );
    const user = userEvent.setup();
    render(<SignIn />);
    expect(firstBox()).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(body).toEqual({ username: 'owner', password: 'correct-horse' });
    });
  });

  it('signs in only with the right app code', async () => {
    fake.mfaCode = '123456';
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(firstBox());
    await user.keyboard('000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username, password or code.');
    expect(fake.tokenIssued).toBeNull();
    await user.click(firstBox());
    await user.keyboard('{Backspace>6/}123456');
    expect(digits()).toBe('123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(fake.tokenIssued).toBe('tok-test');
    });
  });

  it('shows the app code as six digit boxes that move along and take only digits', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    const group = screen.getByRole('group', { name: 'Code' });
    const boxes = within(group).getAllByRole('textbox');
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(boxes[0]).toHaveAttribute('inputmode', 'numeric');
    expect(boxes[5]).toHaveAccessibleName('Digit 6 of 6');
    await user.click(firstBox());
    await user.keyboard('1a2 3');
    expect(digits()).toBe('123');
    expect(boxes[3]).toHaveFocus();
    await user.keyboard('{Backspace}');
    expect(digits()).toBe('12');
  });

  it('fills every box from a pasted code', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.click(firstBox());
    await user.paste('654321');
    expect(digits()).toBe('654321');
  });

  it('sends a recovery code from the plain field, and switching back starts empty', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/api/v1/auth/token', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ access_token: 'tok-test', expires_in: 3600 });
      }),
    );
    const user = userEvent.setup();
    render(<SignIn />);
    await user.click(firstBox());
    await user.keyboard('12');
    await user.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    const field = screen.getByLabelText('Recovery code');
    expect(field).toHaveValue('');
    expect(screen.queryByRole('group', { name: 'Code' })).toBeNull();
    await user.type(field, ' abcde-fghjk ');
    await user.click(screen.getByRole('button', { name: 'Use an app code' }));
    expect(digits()).toBe('');
    await user.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    await user.type(screen.getByLabelText('Recovery code'), ' abcde-fghjk ');
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(body).toEqual({ username: 'owner', password: 'correct-horse', code: 'abcde-fghjk' });
    });
  });

  it('does not keep the code after a successful sign-in', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(firstBox());
    await user.keyboard('123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(digits()).toBe('');
    });
  });
});

/** The six app-code boxes read left to right. */
function digits(): string {
  const group = screen.getByRole('group', { name: 'Code' });
  return within(group)
    .getAllByRole('textbox')
    .map((b) => (b as HTMLInputElement).value)
    .join('');
}

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

  it('the delete dialog sits outside the page, closes on Escape and gives focus back', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    fake.records.set(id, {
      id,
      date: '2026-09-01',
      odometer: 1,
      provider: null,
      description: 'Keep me',
      cost_minor: 100,
      currency: 'MYR',
      notes: null,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    });
    const user = userEvent.setup();
    signedInApp();
    await user.click(await screen.findByRole('link', { name: /Keep me/ }));
    const opener = await screen.findByRole('button', { name: 'Delete' });
    await user.click(opener);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this service record?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(document.querySelector('main')?.contains(dialog)).toBe(false);
    // The page behind is hidden while the dialog is open.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Keep me' })).toBeNull();
    });
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
    expect(fake.deletes).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Keep me' })).toBeInTheDocument();
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

describe('SignIn username', () => {
  it('asks for a username and a password, and disables Sign in until both are filled', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Username'), '   ');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Username'), 'owner');
    expect(button).toBeEnabled();
  });

  it('sends the username and password, and keeps neither in storage', async () => {
    let sent: unknown = null;
    server.use(
      http.post('*/api/v1/auth/token', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ access_token: 'tok-test', expires_in: 3600 });
      }),
    );
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Username'), 'owner');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(sent).toEqual({ username: 'owner', password: 'correct-horse' });
    });
    const dump = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(dump).not.toContain('correct-horse');
    expect(dump).not.toContain('"owner"');
  });

  it('gives one message for a wrong username or a wrong password', async () => {
    const user = userEvent.setup();
    render(<SignIn />);
    await user.type(screen.getByLabelText('Username'), 'someone-else');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username, password or code.');
  });
});

/** The first app-code box, which carries the "Code" label. */
function firstBox(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Code' });
}
