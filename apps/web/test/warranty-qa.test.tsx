import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { addMonths } from '../src/lib/dates';
import { listQueue } from '../src/storage/queue';
import { fake } from './server';
import { claim, cov, cid, lid, plusDays, startTrace, stopTrace } from './warranty-qa-helpers';

afterEach(() => {
  stopTrace();
  vi.useRealTimers();
});

function open(path: string) {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}
async function started() {
  await waitFor(() => {
    expect(fake.templateGets).toBeGreaterThan(0);
  });
  await new Promise((r) => setTimeout(r, 150));
}
const setBaseline = (v: string) => {
  fireEvent.change(screen.getByLabelText(/Baseline start date/), { target: { value: v } });
};
const field = (key: string, f: 'name' | 'start' | 'end' | 'km' | 'notes') =>
  document.getElementById(`tpl-${key}-${f}`) as HTMLInputElement;
const box = (label: RegExp) => screen.getByRole('checkbox', { name: label });
const accept = () => screen.getByRole('button', { name: 'Create selected coverages' });

describe('template page (AC-54..56)', () => {
  test('opening, cancelling and leaving POST nothing', async () => {
    const trace = startTrace();
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    await started();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('heading', { name: /warranty/i, level: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(trace.filter((t) => t.method === 'POST')).toEqual([]);
    expect(await listQueue()).toHaveLength(0);
  });

  test('baseline is required: empty and impossible dates are refused, nothing posted', async () => {
    const trace = startTrace();
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    await user.click(box(/Vehicle warranty/));
    await user.click(accept());
    expect(await screen.findByText(/Enter the baseline start date/)).toBeInTheDocument();
    setBaseline('2026-02-30');
    await user.click(accept());
    expect(screen.getByText(/Enter the baseline start date/)).toBeInTheDocument();
    expect(trace.filter((t) => t.method === 'POST')).toEqual([]);
  });

  test.each([
    ['2026-01-31', { general: '2031-01-31', powertrain: '2034-01-31', wear_short: '2026-07-31' }],
    ['2024-02-29', { general: '2029-02-28', powertrain: '2032-02-29', wear_short: '2024-08-29' }],
    ['2026-08-31', { general: '2031-08-31', powertrain: '2034-08-31', wear_short: '2027-02-28' }],
  ])('end date = baseline %s + months with clamping', async (baseline, want) => {
    open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    setBaseline(baseline);
    for (const [key, end] of Object.entries(want)) {
      expect(field(key, 'end').value).toBe(end);
      expect(field(key, 'start').value).toBe(baseline);
    }
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  test('km is prefilled; edited values are what is posted; only selected items are posted', async () => {
    const trace = startTrace();
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    setBaseline('2026-01-15');
    expect(field('general', 'km').value).toBe('150000');
    expect(field('powertrain', 'km').value).toBe('160000');
    expect(field('wear_short', 'km').value).toBe('10000');
    await user.click(box(/Electric powertrain/));
    fireEvent.change(field('powertrain', 'name'), { target: { value: '  My EV drive  ' } });
    fireEvent.change(field('powertrain', 'km'), { target: { value: '120000' } });
    fireEvent.change(field('powertrain', 'end'), { target: { value: '2030-05-05' } });
    fireEvent.change(field('powertrain', 'notes'), { target: { value: 'checked booklet' } });
    await user.click(accept());
    await waitFor(() => {
      expect(fake.coveragePosts).toHaveLength(1);
    });
    expect(fake.coveragePosts[0]).toMatchObject({
      name: 'My EV drive',
      provider_type: 'factory',
      source_kind: 'template',
      verification_status: 'proposed',
      template_ref: 'my-factory-warranty:powertrain',
      start_date: '2026-01-15',
      end_date: '2030-05-05',
      km_limit: 120000,
      notes: 'checked booklet',
    });
    expect(trace.filter((t) => t.method === 'POST' && t.path.includes('claims'))).toEqual([]);
  });

  test('deselecting everything posts nothing and says so', async () => {
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    setBaseline('2026-01-15');
    await user.click(box(/Vehicle warranty/));
    await user.click(box(/Vehicle warranty/));
    await user.click(accept());
    expect(await screen.findByText('Select at least one item, or cancel.')).toBeInTheDocument();
    expect(fake.coveragePosts).toHaveLength(0);
  });

  test('a row with an invalid edit blocks the whole accept and posts nothing', async () => {
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    setBaseline('2026-01-15');
    await user.click(box(/Vehicle warranty/));
    await user.click(box(/Wear-and-tear/));
    fireEvent.change(field('wear_short', 'km'), { target: { value: '0' } });
    await user.click(accept());
    expect(
      (await screen.findAllByRole('alert')).some((a) => /Wear-and-tear/.test(a.textContent ?? '')),
    ).toBe(true);
    expect(fake.coveragePosts).toHaveLength(0);
  });

  test('genuine_parts has no checkbox, no numbers, and cannot be posted', async () => {
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    const manual = screen.getByTestId('tpl-manual-genuine_parts');
    expect(within(manual).queryByRole('checkbox')).toBeNull();
    expect(within(manual).queryByRole('textbox')).toBeNull();
    setBaseline('2026-01-15');
    for (const b of screen.getAllByRole('checkbox')) await user.click(b);
    await user.click(accept());
    await waitFor(() => {
      expect(fake.coveragePosts).toHaveLength(3);
    });
    expect(fake.coveragePosts.map((p) => p.template_ref)).not.toContain(
      'my-factory-warranty:genuine_parts',
    );
  });

  test('one rejected item does not block the others', async () => {
    fake.coveragePostFailures = [400, 0, 0];
    const user = open('/warranty/template');
    render(<App />);
    await screen.findByTestId('template-suggestion-only');
    setBaseline('2026-01-15');
    for (const b of screen.getAllByRole('checkbox')) await user.click(b);
    await user.click(accept());
    await waitFor(() => {
      expect(fake.coverages.size).toBe(2);
    });
    expect(fake.coveragePosts).toHaveLength(3);
  });

  test('the purchase-date prefill is labelled a guess, a typed date is not', async () => {
    fake.vehicle = {
      id: 'c0000000-0000-4000-8000-000000000001',
      make: 'Zeekr',
      model: '7X',
      variant: null,
      model_year: 2025,
      purchase_date: '2025-03-10',
      vin: null,
      plate: null,
      current_odometer_hint: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    } as never;
    open('/warranty/template');
    render(<App />);
    expect(await screen.findByText(/This is a guess/)).toBeInTheDocument();
    setBaseline('2025-04-01');
    expect(screen.queryByText(/This is a guess/)).toBeNull();
  });

  test.fails(
    'QA-WW6: form fields repeated per template row share one accessible name each',
    async () => {
      open('/warranty/template');
      render(<App />);
      await screen.findByTestId('template-suggestion-only');
      // Three rows each expose "Name", "Start date", "End date", "Km limit", "Notes".
      // A screen reader user cannot tell which row a field belongs to.
      const names = screen.getAllByLabelText('Name');
      expect(names).toHaveLength(1);
    },
  );
});

describe('AC-53 wording across all statuses', () => {
  const FORBIDDEN = /\bnot covered\b|\bguarantee|\bis covered\b|\bcovered by\b|^covered$/i;
  function seedAll() {
    fake.coverages.set(cid(1), cov(cid(1), { name: 'A active', km_limit: 150000 }));
    fake.coverages.set(
      cid(2),
      cov(cid(2), { name: 'B soon', end_date: plusDays(10), status: 'expiring_soon' }),
    );
    fake.coverages.set(
      cid(3),
      cov(cid(3), {
        name: 'C old',
        start_date: '2020-01-01',
        end_date: '2021-01-01',
        status: 'expired',
        expired_by: ['date'],
      }),
    );
    fake.coverages.set(
      cid(4),
      cov(cid(4), {
        name: 'D future',
        start_date: plusDays(50),
        end_date: plusDays(900),
        status: 'not_started',
      }),
    );
    fake.coverages.set(
      cid(5),
      cov(cid(5), {
        name: 'E km',
        end_date: null,
        km_limit: 5,
        status: 'expired',
        expired_by: ['odometer'],
      }),
    );
  }

  test('list: no forbidden wording; each status heading and expired_by label present', async () => {
    seedAll();
    fake.records.set('b0000000-0000-4000-8000-000000000001', {
      id: 'b0000000-0000-4000-8000-000000000001',
      date: '2026-09-01',
      odometer: 99,
      provider: null,
      description: 'Seed',
      cost_minor: 100,
      currency: 'MYR',
      notes: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    });
    open('/warranty');
    const { container } = render(<App />);
    await screen.findByText('A active');
    for (const h of [
      'Active by the dates and km you entered',
      'Expiring soon',
      'Not started',
      'Expired',
    ])
      expect(await screen.findByRole('heading', { name: h })).toBeInTheDocument();
    const badges = screen.getAllByTestId('warranty-status').map((b) => b.textContent ?? '');
    expect(badges.some((b) => /Expired by date/.test(b))).toBe(true);
    expect(badges.some((b) => /Expired by km/.test(b))).toBe(true);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/\bcovered\b/i);
    expect(screen.getByTestId('terms-line')).toBeInTheDocument();
  });

  test.each([1, 2, 3, 4, 5])(
    'detail page %i: fixed documents line, no forbidden wording, status shown as text',
    async (n) => {
      seedAll();
      open(`/warranty/${cid(n)}`);
      const { container } = render(<App />);
      expect(await screen.findByTestId('terms-fixed')).toHaveTextContent(
        'Terms and exclusions are in your warranty documents.',
      );
      expect(container.textContent ?? '').not.toMatch(FORBIDDEN);
      expect(screen.getByTestId('warranty-status').textContent?.trim()).not.toBe('');
    },
  );

  test('template page: no forbidden wording', async () => {
    open('/warranty/template');
    const { container } = render(<App />);
    await screen.findByTestId('template-suggestion-only');
    expect(container.textContent ?? '').not.toMatch(FORBIDDEN);
  });

  test.each(['/warranty/new', `/warranty/${cid(1)}/claims/new`])(
    'no provider-name or certificate-number input on %s',
    async (path) => {
      fake.coverages.set(cid(1), cov(cid(1)));
      open(path);
      render(<App />);
      await started();
      await screen.findByRole('button', { name: /^(Save|Add|Create)/i });
      const labels = Array.from(document.querySelectorAll('label')).map((l) => l.textContent ?? '');
      expect(labels.length).toBeGreaterThan(4);
      for (const l of labels) expect(l).not.toMatch(/provider name|certificate|policy|vin|plate/i);
    },
  );

  test('source kind, verification label and source note are shown on the detail page', async () => {
    fake.coverages.set(
      cid(1),
      cov(cid(1), {
        source_kind: 'template',
        verification_status: 'proposed',
        source_note: 'Booklet page 4',
      }),
    );
    open(`/warranty/${cid(1)}`);
    render(<App />);
    await screen.findByTestId('terms-fixed');
    expect(screen.getByText(/From the suggested template/)).toBeInTheDocument();
    expect(screen.getByText(/Proposed/)).toBeInTheDocument();
    expect(screen.getByText(/Booklet page 4/)).toBeInTheDocument();
  });
});

describe('AC-66 plain text', () => {
  const EVIL = '<img src=x onerror=alert(1)>';
  const SCRIPT = '<script>window.__pwned = 1</script>';

  test('name, notes, source note and claim description render as text', async () => {
    fake.coverages.set(
      cid(1),
      cov(cid(1), { name: EVIL, notes: SCRIPT, source_note: EVIL, claim_count: 1 }),
    );
    fake.claims.set(lid(1), claim(lid(1), cid(1), { description: EVIL, notes: SCRIPT }));
    open(`/warranty/${cid(1)}`);
    const { container } = render(<App />);
    await screen.findByTestId('terms-fixed');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.textContent).toContain(EVIL);
    expect(container.textContent).toContain(SCRIPT);
  });

  test('list view also renders the name as text', async () => {
    fake.coverages.set(cid(1), cov(cid(1), { name: EVIL }));
    open('/warranty');
    const { container } = render(<App />);
    await screen.findByText(EVIL);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('delete confirmation (AC-58)', () => {
  test.each([
    [0, 'This also deletes 0 claims.'],
    [1, 'This also deletes 1 claim.'],
    [3, 'This also deletes 3 claims.'],
  ])('%i claim(s)', async (n, text) => {
    fake.coverages.set(cid(1), cov(cid(1)));
    for (let i = 0; i < n; i++) fake.claims.set(lid(i + 1), claim(lid(i + 1), cid(1)));
    const user = open(`/warranty/${cid(1)}`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByTestId('delete-claim-count')).toHaveTextContent(text);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.coverageDeletes).toHaveLength(0);
    expect(fake.coverages.size).toBe(1);
    expect(fake.claims.size).toBe(n);
  });
});

describe('a11y basics', () => {
  test.each(['/warranty/new', `/warranty/${cid(1)}/claims/new`])(
    'every form control has exactly one unique label on %s',
    async (path) => {
      fake.coverages.set(cid(1), cov(cid(1)));
      open(path);
      render(<App />);
      await started();
      await screen.findByRole('button', { name: /^(Save|Add|Create)/i });
      const controls = Array.from(document.querySelectorAll('input, select, textarea'));
      const seen = new Map<string, number>();
      for (const c of controls) {
        const lbl = c.id ? document.querySelector(`label[for="${c.id}"]`) : null;
        expect(lbl, `${path} control ${c.id}`).not.toBeNull();
        const t = lbl?.textContent ?? '';
        seen.set(t, (seen.get(t) ?? 0) + 1);
      }
      for (const [t, n] of seen) expect(n, `${path} label "${t}"`).toBe(1);
    },
  );

  test('status is text, not colour only', async () => {
    fake.coverages.set(
      cid(1),
      cov(cid(1), { status: 'expired', expired_by: ['date'], end_date: '2021-01-01' }),
    );
    open(`/warranty/${cid(1)}`);
    render(<App />);
    expect((await screen.findByTestId('warranty-status')).textContent).toMatch(/Expired by date/);
  });
});
