import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { AdvisoryProposal } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { server } from './server';

const STAMP = '2026-10-01T00:00:00Z';

function alert(over: Partial<AdvisoryProposal> = {}): AdvisoryProposal {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    condition: 'sentry_off_outside_geofence',
    status: 'proposed',
    inputs: { reading_age_minutes: 4 },
    source_refs: [],
    explanation: null,
    explanation_status: 'disabled',
    urgency: null,
    suggestion: null,
    provenance: { rule_version: 1, prompt_version: null, model_id: null },
    created_at: STAMP,
    updated_at: STAMP,
    decided_at: null,
    ...over,
  };
}

function open() {
  window.history.pushState(null, '', '/sentry');
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('sentry tab', () => {
  it('shows the open geofence alert as a notice, with no send button', async () => {
    server.use(
      http.get('*/api/v1/advisory/proposals', () =>
        HttpResponse.json({
          items: [
            alert(),
            alert({ id: 'c0000000-0000-4000-8000-000000000002', condition: 'charging_cost_drift' }),
          ],
        }),
      ),
    );
    open();
    render(<App />);
    expect(await screen.findAllByTestId('geofence-alert')).toHaveLength(1);
    expect(screen.getByText(/Last reported 4 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent to the car/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept|Sentry on|Turn/ })).toBeNull();
  });

  it('says so when there is no alert', async () => {
    server.use(http.get('*/api/v1/advisory/proposals', () => HttpResponse.json({ items: [] })));
    open();
    render(<App />);
    expect(await screen.findByTestId('sentry-none')).toBeInTheDocument();
  });

  it('dismisses an alert', async () => {
    const patches: unknown[] = [];
    let items = [alert()];
    server.use(
      http.get('*/api/v1/advisory/proposals', () => HttpResponse.json({ items })),
      http.patch('*/api/v1/advisory/proposals/:id', async ({ request: r }) => {
        patches.push(await r.json());
        items = [];
        return HttpResponse.json(alert({ status: 'dismissed' }));
      }),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(patches).toEqual([{ status: 'dismissed' }]);
    });
    expect(await screen.findByTestId('sentry-none')).toBeInTheDocument();
  });
});
