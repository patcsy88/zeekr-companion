import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { reportReachable } from '../src/lib/connectivity';
import {
  enqueueClaimCreate,
  enqueueCoverageCreate,
  listQueue,
  updateEntry,
} from '../src/storage/queue';
import { cid, lid } from './warranty-qa-helpers';

const covBody = {
  id: cid(1),
  name: 'Sec cov',
  provider_type: 'extended' as const,
  start_date: '2026-01-01',
  end_date: null,
  km_limit: 5000,
  notes: null,
  source_kind: 'owner_entered' as const,
  verification_status: 'unverified' as const,
  source_note: null,
  template_ref: null,
};
const claimBody = {
  id: lid(1),
  coverage_id: cid(1),
  date: '2026-02-01',
  odometer: 100,
  description: 'Sec claim',
  status: 'submitted' as const,
  cost_covered_minor: null,
  currency: 'MYR' as const,
  notes: null,
};

async function failedCoverageWithClaim() {
  await enqueueCoverageCreate(covBody);
  await enqueueClaimCreate(claimBody);
  const cover = (await listQueue()).find((e) => e.kind === 'create-coverage');
  await updateEntry(cover?.seq ?? 0, {
    status: 'failed',
    attempts: 1,
    last_error: { status: 400, code: 'validation_error', message: 'Refused.', details: [] },
  });
}

describe('SEC-W3 / SEC-W4: no silent loss of queued claims', () => {
  it('SEC-W3: discarding a failed coverage create tells the owner which claims were dropped', async () => {
    await failedCoverageWithClaim();
    window.history.pushState(null, '', `/warranty/${cid(1)}`);
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    reportReachable(false);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Discard my change' }));
    const notice = await screen.findByTestId('dropped-notice');
    expect(notice).toHaveTextContent(/1 claim saved only on this device/);
    expect(await listQueue()).toHaveLength(0);
  });

  it('SEC-W4: the clear-local-data warning counts blocked claim writes', async () => {
    await failedCoverageWithClaim();
    window.history.pushState(null, '', '/warranty');
    setToken('tok-test', 3600);
    const user = userEvent.setup();
    reportReachable(false);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Sign out and clear local data' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/2 changes have not reached the server/);
  });
});
