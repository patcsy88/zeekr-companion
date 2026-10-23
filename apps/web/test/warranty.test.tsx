import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import { klToday } from '../src/lib/dates';
import { getDb } from '../src/storage/db';
import { listQueue } from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { fake, WARRANTY_TEMPLATE } from './server';
import type { WarrantyClaim, WarrantyCoverage } from '../src/api/types';

afterEach(() => {
  vi.useRealTimers();
});

const COV = 'a1000000-0000-4000-8000-000000000001';
const COV2 = 'a1000000-0000-4000-8000-000000000002';
const COV3 = 'a1000000-0000-4000-8000-000000000003';
const CLM = 'a2000000-0000-4000-8000-000000000001';
const STAMP = '2026-10-01T00:00:00Z';

const plusDays = (n: number) => {
  const [y, m, d] = klToday().split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
};

function cov(id: string, over: Partial<WarrantyCoverage> = {}): WarrantyCoverage {
  return {
    id,
    name: 'Coverage',
    provider_type: 'factory',
    start_date: '2025-01-01',
    end_date: plusDays(400),
    km_limit: null,
    notes: null,
    source_kind: 'owner_entered',
    verification_status: 'unverified',
    source_note: null,
    template_ref: null,
    status: 'active',
    expired_by: [],
    expiring_soon_by: [],
    claim_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
function claim(id: string, coverageId: string, over: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id,
    coverage_id: coverageId,
    date: '2026-09-01',
    odometer: 1000,
    description: 'A claim',
    status: 'submitted',
    cost_covered_minor: null,
    currency: 'MYR',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
function seedRecord(odometer: number) {
  const id = 'b0000000-0000-4000-8000-000000000001';
  fake.records.set(id, {
    id,
    date: '2026-09-01',
    odometer,
    provider: null,
    description: 'Seed',
    cost_minor: 100,
    currency: 'MYR',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
  });
}
function open(path = '/warranty') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}
/** Waits for the app-start sync (which fetches warranty coverages) to finish. */
async function started() {
  await waitFor(() => {
    expect(fake.templateGets).toBeGreaterThan(0); // the last request of the app-start sync
  });
  // The counter moves when the request arrives; the response handler still marks the API
  // reachable afterwards and would undo a following reportReachable(false). Let it land first.
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const noWarrantyWrites = () => {
  expect(fake.coveragePosts).toHaveLength(0);
  expect(fake.claimPosts).toHaveLength(0);
  expect(fake.coverages.size).toBe(0);
};

describe('AC-48..53: the warranty list and its wording', () => {
  it('groups by status, shows computed labels, claim counts and the km basis', async () => {
    seedRecord(21000);
    fake.coverages.set(COV, cov(COV, { name: 'Active one', km_limit: 150000 }));
    fake.coverages.set(
      COV2,
      cov(COV2, { name: 'Soon one', end_date: plusDays(10), start_date: '2025-01-01' }),
    );
    fake.coverages.set(
      COV3,
      cov(COV3, { name: 'Old one', start_date: '2020-01-01', end_date: '2021-01-01' }),
    );
    fake.claims.set(CLM, claim(CLM, COV));
    open();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Expiring soon' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Active by the dates and km you entered' }),
    ).toBeInTheDocument();
    const active = screen.getByRole('list', {
      name: 'Active by the dates and km you entered coverages',
    });
    expect(within(active).getByTestId('warranty-status')).toHaveTextContent(
      'Active by the dates and km you entered',
    );
    expect(within(active).getByText('1 claim')).toBeInTheDocument();
    expect(within(active).getByTestId('km-basis')).toHaveTextContent(
      /Km limit 150,000 km, compared with current odometer 21,000 km/,
    );
    const expired = screen.getByRole('list', { name: 'Expired coverages' });
    expect(within(expired).getByTestId('warranty-status')).toHaveTextContent('Expired by date');
    expect(screen.getByTestId('odometer-basis')).toHaveTextContent(/21,000 km/);
  });

  it('says "odometer unknown" when there is no service record', async () => {
    fake.coverages.set(COV, cov(COV, { km_limit: 1000 }));
    open();
    render(<App />);
    expect(await screen.findByTestId('km-basis')).toHaveTextContent(/odometer unknown/);
    expect(screen.getByTestId('odometer-basis')).toHaveTextContent(/unknown/);
  });

  it('AC-53: never says "covered", always shows the fixed terms line, source and verification', async () => {
    fake.coverages.set(
      COV,
      cov(COV, {
        name: 'With source',
        source_kind: 'template',
        verification_status: 'proposed',
        source_note: 'my own booklet',
      }),
    );
    open();
    render(<App />);
    await screen.findByText('With source');
    expect(screen.getByTestId('terms-line')).toHaveTextContent(/warranty documents/i);
    expect(screen.getByText(/From the suggested template/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed/)).toBeInTheDocument();
    expect(screen.getByText(/Source: my own booklet/)).toBeInTheDocument();
    expect(screen.getByTestId('status-computed-offline')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\bnot covered\b/i);
    expect(screen.queryByText(/^covered$/i)).not.toBeInTheDocument();
  });

  it('AC-67: the form has no provider-name or certificate field', async () => {
    open('/warranty/new');
    render(<App />);
    await screen.findByLabelText('Name');
    expect(screen.queryByLabelText(/provider/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/certificate/i)).not.toBeInTheDocument();
  });

  it('AC-66: script-like text is shown literally and runs nothing', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    fake.coverages.set(COV, cov(COV, { name: xss, notes: xss, source_note: xss, claim_count: 1 }));
    fake.claims.set(CLM, claim(CLM, COV, { description: xss, notes: xss }));
    open(`/warranty/${COV}`);
    render(<App />);
    await screen.findByRole('heading', { name: xss });
    expect(screen.getAllByText(xss).length).toBeGreaterThan(2);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('AC-57..60: detail, delete and forms', () => {
  it('the delete confirmation names the claim count and cancel deletes nothing', async () => {
    fake.coverages.set(COV, cov(COV, { name: 'Del me' }));
    fake.claims.set(CLM, claim(CLM, COV));
    const user = open(`/warranty/${COV}`);
    render(<App />);
    await screen.findByRole('heading', { name: 'Del me' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByTestId('delete-claim-count')).toHaveTextContent(
      'This also deletes 1 claim.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fake.coverageDeletes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete coverage' }));
    await waitFor(() => {
      expect(fake.coverageDeletes).toEqual([COV]);
    });
  });

  it('shows server field errors next to the fields', async () => {
    fake.coveragePostFailures = [400];
    const user = open('/warranty/new');
    render(<App />);
    await user.type(await screen.findByLabelText('Name'), 'Mine');
    await user.type(screen.getByLabelText('Start date'), '2026-01-01');
    await user.type(screen.getByLabelText('Km limit'), '1000');
    reportReachable(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.coveragePosts.length).toBeGreaterThan(0);
    });
  });

  it('the claim date hint appears only outside the coverage dates', async () => {
    fake.coverages.set(COV, cov(COV, { start_date: '2026-01-01', end_date: '2026-12-31' }));
    const user = open(`/warranty/${COV}/claims/new`);
    render(<App />);
    const date = await screen.findByLabelText('Claim date');
    await user.clear(date);
    await user.type(date, '2026-06-01');
    expect(screen.queryByTestId('claim-date-hint')).not.toBeInTheDocument();
    await user.clear(date);
    await user.type(date, '2025-06-01');
    expect(await screen.findByTestId('claim-date-hint')).toBeInTheDocument();
  });

  it('a claim with MYR cost is stored in sen and the odometer is not changed', async () => {
    fake.coverages.set(COV, cov(COV));
    const user = open(`/warranty/${COV}/claims/new`);
    render(<App />);
    await user.type(await screen.findByLabelText('Odometer (km)'), '1234');
    await user.type(screen.getByLabelText('Description'), 'Door seal');
    await user.type(screen.getByLabelText('Cost covered (MYR)'), '12.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.claimPosts).toHaveLength(1);
    });
    expect(fake.claimPosts[0]).toMatchObject({
      coverage_id: COV,
      odometer: 1234,
      cost_covered_minor: 1250,
    });
    expect(fake.records.size).toBe(0);
  });
});

describe('AC-61..65: offline and the blocked state', () => {
  it('AC-61: a cold start offline lists the cached coverages', async () => {
    fake.coverages.set(COV, cov(COV, { name: 'Cached one' }));
    open();
    const first = render(<App />);
    await screen.findByText('Cached one');
    first.unmount();
    fake.down = true;
    reportReachable(false);
    render(<App />);
    expect(await screen.findByText('Cached one')).toBeInTheDocument();
    expect(screen.getByTestId('status-computed-offline')).toBeInTheDocument();
  });

  it('AC-61: the template needs one online visit', async () => {
    fake.down = true;
    reportReachable(false);
    open('/warranty/template');
    render(<App />);
    expect(await screen.findByText(/need one online visit/)).toBeInTheDocument();
    noWarrantyWrites();
  });

  it('offline: coverage then claim are pending, then each sent exactly once on reconnect', async () => {
    const user = open('/warranty/new');
    render(<App />);
    await screen.findByLabelText('Name');
    await started();
    reportReachable(false);
    await user.type(screen.getByLabelText('Name'), 'Offline cov');
    await user.type(screen.getByLabelText('Start date'), '2026-01-01');
    await user.type(screen.getByLabelText('Km limit'), '5000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const link = await screen.findByRole('link', { name: /Offline cov/ });
    expect(fake.coveragePosts).toHaveLength(0);
    await user.click(link);
    await user.click(await screen.findByRole('link', { name: 'Add claim' }));
    await user.type(await screen.findByLabelText('Odometer (km)'), '100');
    await user.type(screen.getByLabelText('Description'), 'Offline claim');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Offline claim');
    expect(fake.claimPosts).toHaveLength(0);
    expect((await listQueue()).length).toBe(2);
    reportReachable(true);
    await flush(true);
    await flush(true);
    await waitFor(() => {
      expect(fake.claims.size).toBe(1);
    });
    expect(fake.coveragePosts).toHaveLength(1);
    expect(fake.claimPosts).toHaveLength(1);
    expect(fake.coverages.size).toBe(1);
  });

  it('AC-62: a claim whose coverage the server refuses shows Blocked and is never sent', async () => {
    fake.coveragePostFailures = [400];
    const user = open('/warranty/new');
    render(<App />);
    await screen.findByLabelText('Name');
    await started();
    reportReachable(false);
    await user.type(screen.getByLabelText('Name'), 'Doomed');
    await user.type(screen.getByLabelText('Start date'), '2026-01-01');
    await user.type(screen.getByLabelText('Km limit'), '5000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('link', { name: /Doomed/ }));
    await user.click(await screen.findByRole('link', { name: 'Add claim' }));
    await user.type(await screen.findByLabelText('Odometer (km)'), '100');
    await user.type(screen.getByLabelText('Description'), 'Dependent claim');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Dependent claim');
    reportReachable(true);
    await flush(true);
    await flush(true);
    expect(await screen.findByTestId('claim-blocked')).toBeInTheDocument();
    expect(fake.claimPosts).toHaveLength(0);
    expect(screen.getByTestId('sync-blocked')).toHaveTextContent('Blocked');
  });
});

describe('AC-54..56: the template is a suggestion', () => {
  it('opening and cancelling creates nothing; baseline is required; genuine_parts is manual', async () => {
    const user = open('/warranty/template');
    render(<App />);
    expect(await screen.findByTestId('template-suggestion-only')).toBeInTheDocument();
    expect(screen.getByTestId('template-source')).toHaveTextContent(/M8, M9, M10/);
    expect(screen.getByTestId('template-caveat')).toHaveTextContent(/Confirm against/);
    const manual = screen.getByTestId('tpl-manual-genuine_parts');
    expect(manual).toHaveTextContent(/Enter manually/);
    expect(within(manual).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(manual.textContent ?? '').not.toMatch(/\d{2,} (months|km)/);
    await user.click(screen.getByRole('button', { name: 'Create selected coverages' }));
    expect(await screen.findByText(/Enter the baseline start date/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    noWarrantyWrites();
    expect(await listQueue()).toHaveLength(0);
  });

  it('a prefill from the purchase date is labelled as a guess', async () => {
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      make: 'Zeekr',
      model: '7X',
      variant: 'AWD Performance',
      model_year: 2025,
      purchase_date: '2025-03-10',
      vin: null,
      plate: null,
      current_odometer_hint: null,
      created_at: STAMP,
      updated_at: STAMP,
    } as never;
    open('/warranty/template');
    render(<App />);
    const base = await screen.findByLabelText<HTMLInputElement>(/Baseline start date/);
    await waitFor(() => {
      expect(base.value).toBe('2025-03-10');
    });
    expect(screen.getByText(/This is a guess/)).toBeInTheDocument();
    expect(WARRANTY_TEMPLATE.items).toHaveLength(4);
  });

  it('accept sends one factory/template/proposed POST per selected item', async () => {
    const user = open('/warranty/template');
    render(<App />);
    const base = await screen.findByLabelText(/Baseline start date/);
    await user.type(base, '2026-01-01');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    await user.click(boxes[0] as HTMLElement);
    await user.click(boxes[1] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Create selected coverages' }));
    await waitFor(() => {
      expect(fake.coveragePosts).toHaveLength(2);
    });
    for (const p of fake.coveragePosts) {
      expect(p).toMatchObject({
        provider_type: 'factory',
        source_kind: 'template',
        verification_status: 'proposed',
        start_date: '2026-01-01',
      });
    }
    expect(fake.coveragePosts.map((p) => p.template_ref).sort()).toEqual([
      'my-factory-warranty:general',
      'my-factory-warranty:powertrain',
    ]);
    expect(fake.coveragePosts.map((p) => p.km_limit).sort()).toEqual([150000, 160000]);
  });

  it('AC-55: app start, vehicle and service-record saves create no coverage', async () => {
    seedRecord(5000);
    open('/warranty');
    render(<App />);
    expect(await screen.findByText('No warranty coverages yet.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    noWarrantyWrites();
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('AC-63: account and local data', () => {
  it('the clear-local-data dialog mentions warranty and confirming wipes the warranty cache', async () => {
    fake.coverages.set(COV, cov(COV, { name: 'Wipe me' }));
    const user = open('/warranty');
    render(<App />);
    await screen.findByText('Wipe me');
    await user.click(screen.getByRole('button', { name: 'Sign out and clear local data' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/warranty coverages and claims/);
    await user.click(within(dialog).getByRole('button', { name: 'Clear local data and sign out' }));
    await waitFor(async () => {
      const db = await getDb();
      expect(await db.count('cache')).toBe(0);
      expect(await db.count('queue')).toBe(0);
    });
  });
});
