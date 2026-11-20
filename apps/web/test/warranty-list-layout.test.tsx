import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { WarrantyCoverage } from '../src/api/types';
import { CoverageItem } from '../src/components/WarrantyParts';

const coverage = {
  id: '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a',
  name: 'Synthetic long corrosion warranty name for the layout check',
  provider_type: 'manufacturer',
  source_kind: 'template',
  verification_status: 'proposed',
  source_note: 'A long synthetic source note that goes on and on to fill the card width',
  start_date: '2025-11-27',
  end_date: '2030-11-27',
  km_limit: 150000,
  status: 'active',
  expired_by: [],
  claim_count: 0,
} as unknown as WarrantyCoverage;

function show(sync: 'synced' | 'pending') {
  render(
    <MemoryRouter>
      <ul>
        <CoverageItem view={{ coverage, sync, error: null }} basis={null} />
      </ul>
    </MemoryRouter>,
  );
  return screen.getByRole('listitem');
}

describe('Warranty list card layout', () => {
  it('puts the badges in a row under the text, not in a side column', () => {
    const card = show('pending');
    const badges = within(card).getByTestId('coverage-badges');
    const link = within(card).getByRole('link');
    expect(card.className).toContain('flex-col');
    expect(link.contains(badges)).toBe(false);
    expect(card.children[0]).toBe(link);
    expect(card.children[1]).toBe(badges);
    expect(within(badges).getByTestId('warranty-status')).toBeInTheDocument();
    expect(within(badges).getByTestId('sync-pending')).toBeInTheDocument();
  });

  it('lets a long status label wrap instead of widening the badge', () => {
    const card = show('synced');
    const status = within(card).getByTestId('warranty-status');
    expect(status).toHaveTextContent('Active by the dates and km you entered');
    expect(status.className).toContain('whitespace-normal');
    expect(status.className).not.toContain('whitespace-nowrap');
    expect(status.className).toContain('h-auto');
    expect(status.className).toContain('sm:h-auto');
  });
});
