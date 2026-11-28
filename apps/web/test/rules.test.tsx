import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { assertContractPath } from '../src/api/client';
import type { NotificationRule, NotificationRuleOptions } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { server } from './server';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

function options(over: Partial<NotificationRuleOptions> = {}): NotificationRuleOptions {
  return {
    fields: [
      {
        field: 'vehicle_status',
        name: 'Vehicle Status',
        options: [
          { code: '0', label: 'Deep Sleep', verified: false },
          { code: '1', label: 'Parked', verified: false },
        ],
      },
      {
        field: 'engine_status',
        name: 'Engine Status',
        options: [{ code: 'engine-off', label: 'Engine off', verified: false }],
      },
      {
        field: 'gear',
        name: 'Gear',
        options: [{ code: '0', label: 'Park (P)', verified: true }],
      },
      {
        field: 'location',
        name: 'Car location',
        options: [
          { code: 'outside', label: 'Outside the geofence', verified: false },
          { code: 'inside', label: 'Inside the geofence', verified: false },
        ],
      },
    ],
    match: [
      { code: 'all', label: 'All conditions (AND)', verified: false },
      { code: 'any', label: 'Any condition (OR)', verified: false },
    ],
    limits: {
      max_rules: 5,
      max_conditions: 4,
      cooldown_minutes_min: 0,
      cooldown_minutes_max: 1440,
      cooldown_minutes_default: 10,
      radius_km_max: 100,
    },
    push_ready: true,
    ...over,
  };
}

function rule(over: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: ID,
    name: 'Parked and off',
    match: 'all',
    enabled: true,
    cooldown_minutes: 10,
    conditions: [
      { field: 'vehicle_status', codes: ['0', '1'] },
      { field: 'engine_status', codes: ['engine-off'] },
    ],
    last_matched: null,
    last_result: 'not checked yet',
    last_sent_at: null,
    ...over,
  };
}

function open(rules: NotificationRule[] = [], opts = options()) {
  server.use(
    http.get('*/api/v1/notification-rules/options', () => HttpResponse.json(opts)),
    http.get('*/api/v1/notification-rules', () => HttpResponse.json(rules)),
  );
  window.history.pushState(null, '', '/setup/notifications');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('rules: request paths', () => {
  it('allows the collection, the options and one rule by id', () => {
    for (const ok of [
      '/notification-rules',
      '/notification-rules/options',
      `/notification-rules/${ID}`,
    ])
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
  });

  it('refuses everything else', () => {
    for (const bad of [
      '/notification-rules?x=1',
      '/notification-rules/',
      '/notification-rules/other',
      '/notification-rules/not-a-uuid',
      `/notification-rules/${ID}/x`,
      `/notification-rules/${ID}?x=1`,
      '/notification-rules/options/x',
      '/notification-rules/../vehicle',
    ])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });
});

describe('rules: the list', () => {
  it('shows the empty state and the count', async () => {
    open([]);
    render(<App />);
    expect(await screen.findByText('No rules yet.')).toBeInTheDocument();
    expect(screen.getByTestId('rules-count')).toHaveTextContent('0 of 5 rules.');
  });

  it('shows the summary, the last result and the last sent time', async () => {
    open([
      rule({
        last_result: 'matched, sent',
        last_sent_at: '2026-11-20T12:00:00Z',
        match: 'any',
      }),
    ]);
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Rules' });
    expect(list).toHaveTextContent('Parked and off');
    expect(list).toHaveTextContent(
      'Vehicle Status: Deep Sleep, Parked or Engine Status: Engine off',
    );
    expect(list).toHaveTextContent('Last check: matched, sent');
    expect(list).toHaveTextContent('Last sent');
  });

  it('shows not checked yet and marks a rule that is off', async () => {
    open([rule({ enabled: false })]);
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Rules' });
    expect(list).toHaveTextContent('Parked and off (off)');
    expect(list).toHaveTextContent('Last check: not checked yet.');
  });

  it('says nothing will be sent when push is not set up', async () => {
    open([], options({ push_ready: false }));
    render(<App />);
    expect(await screen.findByTestId('rules-push-off')).toHaveTextContent('nothing will be sent');
  });

  it('shows no push notice when push is ready', async () => {
    open([]);
    render(<App />);
    await screen.findByTestId('rules-count');
    expect(screen.queryByTestId('rules-push-off')).toBeNull();
  });

  it('shows the location in words and shows no coordinates', async () => {
    open([rule({ conditions: [{ field: 'location', where: 'outside', radius_km: 5 }] })]);
    render(<App />);
    const card = await screen.findByTestId('rules-card');
    await within(card).findByRole('list', { name: 'Rules' });
    expect(card).toHaveTextContent('Car location: Outside the geofence, 5 km');
    expect(card.textContent).not.toMatch(/-?\d+\.\d{3,}/);
  });

  it('disables Add rule at the limit', async () => {
    const five = [1, 2, 3, 4, 5].map((n) =>
      rule({ id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`, name: `R${n}` }),
    );
    open(five);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Add rule' })).toBeDisabled();
    expect(screen.getByText(/limit of 5 rules is reached/)).toBeInTheDocument();
  });
});

describe('rules: offline and errors', () => {
  it('says so when the server cannot be reached for the list', async () => {
    open([]);
    server.use(
      http.get('*/api/v1/notification-rules', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'The rules failed to load.', details: [] } },
          { status: 500 },
        ),
      ),
    );
    render(<App />);
    expect(await screen.findByText('The rules failed to load.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  });

  it('shows a short note, not the list, once the server cannot be reached', async () => {
    open([]);
    server.use(http.all('*/api/v1/notification-rules*', () => HttpResponse.error()));
    render(<App />);
    expect(await screen.findByTestId('rules-offline')).toHaveTextContent(
      'need a sign-in and a connection',
    );
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  });
});

describe('rules: add and edit', () => {
  async function newRule(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Add rule' }));
    return screen.findByRole('form', { name: 'New rule' });
  }

  it('creates a rule from the tick lists', async () => {
    const user = open([]);
    let sent: unknown = null;
    server.use(
      http.post('*/api/v1/notification-rules', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(rule(), { status: 201 });
      }),
    );
    render(<App />);
    const form = await newRule(user);
    await user.type(within(form).getByLabelText('Name'), 'Parked and off');
    await user.click(within(form).getByText(/Vehicle Status: not used/));
    await user.click(within(form).getByRole('checkbox', { name: /Deep Sleep/ }));
    await user.click(within(form).getByRole('checkbox', { name: /Parked/ }));
    await user.click(within(form).getByText(/Engine Status: not used/));
    await user.click(within(form).getByRole('checkbox', { name: /Engine off/ }));
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => {
      expect(sent).toEqual({
        name: 'Parked and off',
        match: 'all',
        cooldown_minutes: 10,
        enabled: true,
        conditions: [
          { field: 'vehicle_status', codes: ['0', '1'] },
          { field: 'engine_status', codes: ['engine-off'] },
        ],
      });
    });
    expect(await screen.findByText('Rule saved.')).toBeInTheDocument();
  });

  it('puts the location in the request with its radius', async () => {
    const user = open([]);
    let sent: { conditions?: unknown } = {};
    server.use(
      http.post('*/api/v1/notification-rules', async ({ request }) => {
        sent = (await request.json()) as { conditions?: unknown };
        return HttpResponse.json(rule(), { status: 201 });
      }),
    );
    render(<App />);
    const form = await newRule(user);
    await user.type(within(form).getByLabelText('Name'), 'Away');
    await user.selectOptions(within(form).getByLabelText('Car location'), 'outside');
    const radius = within(form).getByLabelText('Radius (km)');
    await user.clear(radius);
    await user.type(radius, '7.5');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => {
      expect(sent.conditions).toEqual([{ field: 'location', where: 'outside', radius_km: 7.5 }]);
    });
  });

  it('marks an option that is not verified and leaves a verified one plain', async () => {
    const user = open([]);
    render(<App />);
    const form = await newRule(user);
    await user.click(within(form).getByText(/Vehicle Status: not used/));
    expect(within(form).getByText('Deep Sleep').parentElement).toHaveTextContent(
      'Deep Sleep (unverified)',
    );
    await user.click(within(form).getByText(/Gear: not used/));
    expect(within(form).getByText('Park (P)').parentElement).not.toHaveTextContent('unverified');
  });

  it('counts the ticked values in the summary line of a list', async () => {
    const user = open([]);
    render(<App />);
    const form = await newRule(user);
    await user.click(within(form).getByText(/Vehicle Status: not used/));
    await user.click(within(form).getByRole('checkbox', { name: /Deep Sleep/ }));
    expect(within(form).getByText(/Vehicle Status: 1 chosen/)).toBeInTheDocument();
  });

  it.each([
    ['', '10', 'The name needs 1 to 60 characters.'],
    ['Name', '1441', 'The cooldown must be a whole number from 0 to 1440 minutes.'],
    ['Name', '-1', 'The cooldown must be a whole number from 0 to 1440 minutes.'],
    ['Name', '1.5', 'The cooldown must be a whole number from 0 to 1440 minutes.'],
    ['Name', '', 'The cooldown must be a whole number from 0 to 1440 minutes.'],
    ['Name', '10', 'Choose at least one condition.'],
  ])('refuses name %j and cooldown %j with a message', async (name, cooldown, text) => {
    const user = open([]);
    let posted = false;
    server.use(
      http.post('*/api/v1/notification-rules', () => {
        posted = true;
        return HttpResponse.json(rule(), { status: 201 });
      }),
    );
    render(<App />);
    const form = await newRule(user);
    if (name) await user.type(within(form).getByLabelText('Name'), name);
    const box = within(form).getByLabelText('Cooldown (minutes)');
    await user.clear(box);
    if (cooldown) await user.type(box, cooldown);
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(text);
    expect(posted).toBe(false);
  });

  it.each(['0', '101', '', 'abc'])('refuses the radius %j', async (radius) => {
    const user = open([]);
    render(<App />);
    const form = await newRule(user);
    await user.type(within(form).getByLabelText('Name'), 'Away');
    await user.selectOptions(within(form).getByLabelText('Car location'), 'outside');
    const box = within(form).getByLabelText('Radius (km)');
    await user.clear(box);
    if (radius) await user.type(box, radius);
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'The radius must be above 0 and at most 100 km.',
    );
  });

  it('shows the server message when a save fails and keeps the form', async () => {
    const user = open([]);
    server.use(
      http.post('*/api/v1/notification-rules', () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'The limit of 5 rules is reached.', details: [] } },
          { status: 409 },
        ),
      ),
    );
    render(<App />);
    const form = await newRule(user);
    await user.type(within(form).getByLabelText('Name'), 'A');
    await user.selectOptions(within(form).getByLabelText('Car location'), 'inside');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'The limit of 5 rules is reached.',
    );
    expect(screen.getByRole('form', { name: 'New rule' })).toBeInTheDocument();
  });

  it('cancels back to the list without a request', async () => {
    const user = open([]);
    let posted = false;
    server.use(
      http.post('*/api/v1/notification-rules', () => {
        posted = true;
        return HttpResponse.json(rule(), { status: 201 });
      }),
    );
    render(<App />);
    const form = await newRule(user);
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('No rules yet.')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('edits a rule: fills the form, says what a change does, and saves with PUT', async () => {
    const user = open([rule({ cooldown_minutes: 30, match: 'any' })]);
    let body: unknown = null;
    let url = '';
    server.use(
      http.put('*/api/v1/notification-rules/:id', async ({ request }) => {
        body = await request.json();
        url = new URL(request.url).pathname;
        return HttpResponse.json(rule());
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Edit Parked and off' }));
    const form = await screen.findByRole('form', { name: 'Edit rule' });
    expect(within(form).getByLabelText('Name')).toHaveValue('Parked and off');
    expect(within(form).getByLabelText('Cooldown (minutes)')).toHaveValue('30');
    expect(within(form).getByLabelText('Match')).toHaveValue('any');
    expect(within(form).getByText(/lets this rule send once more/)).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('Cooldown (minutes)'));
    await user.type(within(form).getByLabelText('Cooldown (minutes)'), '0');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => {
      expect(url).toBe(`/api/v1/notification-rules/${ID}`);
    });
    expect(body).toMatchObject({ cooldown_minutes: 0, match: 'any' });
  });

  it('shows a saved location with its radius when editing', async () => {
    const user = open([
      rule({ conditions: [{ field: 'location', where: 'inside', radius_km: 3 }] }),
    ]);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Edit Parked and off' }));
    const form = await screen.findByRole('form', { name: 'Edit rule' });
    expect(within(form).getByLabelText('Car location')).toHaveValue('inside');
    expect(within(form).getByLabelText('Radius (km)')).toHaveValue('3');
  });

  it('shows the edit hint only when editing', async () => {
    const user = open([]);
    render(<App />);
    const form = await newRule(user);
    expect(within(form).queryByText(/lets this rule send once more/)).toBeNull();
  });
});

describe('rules: delete', () => {
  it('asks first, and does not delete on Cancel', async () => {
    const user = open([rule()]);
    let deleted = false;
    server.use(
      http.delete('*/api/v1/notification-rules/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete Parked and off' }));
    expect(await screen.findByText('Delete this rule?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).toBe(false);
    expect(screen.getByRole('list', { name: 'Rules' })).toBeInTheDocument();
  });

  it('deletes after the confirmation and reloads the list', async () => {
    const user = open([rule(), rule({ id: ID2, name: 'Second' })]);
    let calls = 0;
    server.use(
      http.get('*/api/v1/notification-rules', () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1
            ? [rule(), rule({ id: ID2, name: 'Second' })]
            : [rule({ id: ID2, name: 'Second' })],
        );
      }),
      http.delete('*/api/v1/notification-rules/:id', ({ params }) => {
        expect(params.id).toBe(ID);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete Parked and off' }));
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }));
    expect(await screen.findByText('Rule deleted.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Parked and off')).toBeNull();
    });
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('shows the server message when a delete fails', async () => {
    const user = open([rule()]);
    server.use(
      http.delete('*/api/v1/notification-rules/:id', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Rule not found.', details: [] } },
          { status: 404 },
        ),
      ),
    );
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete Parked and off' }));
    await user.click(await screen.findByRole('button', { name: 'Delete rule' }));
    expect(await screen.findByText('Rule not found.')).toBeInTheDocument();
  });
});

describe('rules: the page', () => {
  it('sits under the alerts card on Setup, Notifications', async () => {
    open([]);
    render(<App />);
    const rules = await screen.findByTestId('rules-card');
    const push = await screen.findByTestId('push-card');
    expect(push.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rules).toHaveTextContent('never sends a command to the car');
  });
});
