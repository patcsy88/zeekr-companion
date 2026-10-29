import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { assertContractPath, request } from '../src/api/client';
import type { AdvisoryProposal } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { server } from './server';

const PID = 'c0000000-0000-4000-8000-000000000001';
const STAMP = '2026-10-01T00:00:00Z';

function proposal(over: Partial<AdvisoryProposal> = {}): AdvisoryProposal {
  return {
    id: PID,
    condition: 'date_vs_km_warranty',
    status: 'proposed',
    inputs: { km_to_limit: 1000, days_to_expiry: 200, projected_limit_date: '2026-11-10' },
    source_refs: [],
    explanation: null,
    explanation_status: 'disabled',
    urgency: null,
    suggestion: {
      kind: 'review_reminder',
      title: 'Review warranty km limit',
      due_date: '2026-11-10',
      due_odometer: 11000,
    },
    provenance: { rule_version: 1, prompt_version: null, model_id: null },
    created_at: STAMP,
    updated_at: STAMP,
    decided_at: null,
    ...over,
  };
}

const status = {
  model_enabled: false,
  model_id: null,
  calls_this_month: 0,
  monthly_limit: 60,
  month: '2026-10',
};

function serve(items: AdvisoryProposal[], patches: unknown[] = []) {
  server.use(
    http.get('*/api/v1/advisory/proposals', () => HttpResponse.json({ items })),
    http.get('*/api/v1/advisory/status', () => HttpResponse.json(status)),
    http.patch('*/api/v1/advisory/proposals/:id', async ({ request: r }) => {
      patches.push(await r.json());
      return HttpResponse.json(proposal({ status: 'dismissed' }));
    }),
  );
}

function open(path = '/advisory') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('advisory: request paths', () => {
  it('allows only the six advisory endpoints', () => {
    for (const ok of [
      '/advisory/checks',
      '/advisory/status',
      '/advisory/proposals',
      '/advisory/proposals?status=proposed&limit=50',
      `/advisory/proposals/${PID}`,
      '/advisory/model-calls?limit=20',
    ])
      expect(() => {
        assertContractPath(ok);
      }).not.toThrow();
    for (const bad of [
      '/advisory',
      '/advisory/',
      '/advisory/other',
      '/advisory/checks?x=1',
      '/advisory/proposals/not-a-uuid',
      '/advisory/proposals/../vehicle',
      '/advisory/proposals/%2e%2e',
      `/advisory/proposals/${PID}/x`,
      `/advisory/proposals/${PID}?x=1`,
      '/advisory/proposals?a=b?c',
    ])
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
  });

  it('refuses a bad advisory path without calling fetch', async () => {
    setToken('tok-test', 3600);
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(request({ method: 'GET', path: '/advisory/x' })).rejects.toMatchObject({
      name: 'ClientError',
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('advisory: the page', () => {
  it('lists a suggestion with its inputs, the model note and the provenance', async () => {
    serve([proposal()]);
    open();
    render(<App />);
    expect(await screen.findByText(/Warranty km limit may be reached/)).toBeInTheDocument();
    expect(screen.getByText('km left to limit')).toBeInTheDocument();
    expect(screen.getByText(/the model is switched off/)).toBeInTheDocument();
    expect(screen.getByText(/Rule version 1/)).toBeInTheDocument();
    expect(await screen.findByTestId('advisory-status')).toHaveTextContent('Model: off');
  });

  it('shows an empty state', async () => {
    serve([]);
    open();
    render(<App />);
    expect(await screen.findByText('No open suggestions.')).toBeInTheDocument();
  });

  it('runs the checks and reports what was skipped', async () => {
    serve([]);
    server.use(
      http.post('*/api/v1/advisory/checks', () =>
        HttpResponse.json({
          created: [],
          unchanged: 2,
          skipped: [{ condition: 'charging_cost_drift', reason: 'not_enough_data' }],
          model: { status: 'disabled', calls_this_month: 0, monthly_limit: 60 },
        }),
      ),
    );
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Run checks now' }));
    const out = await screen.findByTestId('advisory-run');
    expect(out).toHaveTextContent('0 new, 2 already known');
    expect(out).toHaveTextContent('not enough data');
  });

  it('dismisses with PATCH and nothing else', async () => {
    const patches: unknown[] = [];
    serve([proposal()], patches);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => {
      expect(patches).toEqual([{ status: 'dismissed' }]);
    });
  });

  it('does not offer Accept when there is no suggestion', async () => {
    serve([proposal({ condition: 'charging_cost_drift', suggestion: null })]);
    open();
    render(<App />);
    await screen.findByText(/Charging cost per kWh/);
    expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
  });

  it('Accept opens the reminder form prefilled and marks it accepted only after saving', async () => {
    const patches: unknown[] = [];
    serve([proposal()], patches);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Accept/ }));
    expect(await screen.findByRole('heading', { name: 'Add reminder' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('Review warranty km limit');
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-11-10');
    expect(screen.getByLabelText(/Due odometer/)).toHaveValue('11000');
    expect(patches).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(patches).toEqual([{ status: 'accepted' }]);
    });
  });

  it('cancelling the prefilled form decides nothing', async () => {
    const patches: unknown[] = [];
    serve([proposal()], patches);
    const user = open();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Accept/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Advisory' })).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it('a plain new reminder is not prefilled', async () => {
    const user = open('/reminders/new');
    render(<App />);
    expect(await screen.findByLabelText(/Title/)).toHaveValue('');
    expect(user).toBeTruthy();
  });
});
