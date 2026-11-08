import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { Vehicle } from '../src/api/types';
import { setToken } from '../src/auth/session';
import { parseVariant, variantText } from '../src/lib/vehicleCatalogue';
import { setCache } from '../src/storage/cache';
import { fake } from './server';

/** Server and device cache both hold the profile, as on a device that has synced before. */
async function seedVehicle(over: Partial<Vehicle> = {}) {
  const v: Vehicle = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    model: '7X',
    variant: '',
    drive: 'AWD',
    steering: 'RHD',
    registration: null,
    vin: null,
    purchase_date: null,
    purchase_price_minor: 0,
    currency: 'MYR',
    tyre_spec: null,
    ...over,
  };
  fake.vehicle = v;
  await setCache('vehicle', { value: v });
}
function open() {
  window.history.pushState(null, '', '/vehicle/edit');
  setToken('tok-test', 3600);
  return userEvent.setup();
}
/** Waits for the app-start sync to finish (the template is its last request), then the form. */
async function variantBox() {
  await waitFor(() => {
    expect(fake.templateGets).toBeGreaterThan(0);
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  return screen.findByRole('combobox', { name: 'Variant' });
}
const select = (name: string) => screen.getByRole<HTMLSelectElement>('combobox', { name });
const options = (name: string) => Array.from(select(name).options, (o) => o.textContent);
const value = (name: string) => select(name).value;

describe('AC-87: variant list and model year', () => {
  it('lists the four Malaysian variants', async () => {
    open();
    render(<App />);
    await variantBox();
    expect(options('Variant')).toEqual([
      'Choose a variant',
      'RWD Standard Range',
      'RWD Long Range',
      'AWD Performance',
      'Black Nova',
    ]);
  });

  it('shows the years for the chosen variant, and picks the only year for Black Nova', async () => {
    const user = open();
    render(<App />);
    await user.selectOptions(await variantBox(), 'AWD Performance');
    expect(options('Model year')).toEqual(['Choose a year', '2025', '2026']);
    expect(value('Model year')).toBe('');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'Black Nova');
    expect(options('Model year')).toEqual(['Choose a year', '2026']);
    expect(value('Model year')).toBe('2026');
  });

  it('requires a variant and a year, then saves the year appended to the variant', async () => {
    const user = open();
    render(<App />);
    await variantBox();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose a variant.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'AWD Performance');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose a model year.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model year' }), '2025');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.vehicle?.variant).toBe('AWD Performance (2025)');
    });
    expect(fake.vehicle?.tyre_spec).toBe('265/45 R20');
    expect(fake.vehicle?.drive).toBe('AWD');
  });
});

describe('AC-88: tyre specification defaults from the variant and can be overridden', () => {
  it('defaults to the variant size and lists only the sizes for that variant', async () => {
    const user = open();
    render(<App />);
    await user.selectOptions(await variantBox(), 'RWD Long Range');
    expect(value('Tyre specification')).toBe('255/50 R19');
    expect(options('Tyre specification')).toEqual([
      'Not set',
      '255/50 R19',
      '265/45 R20',
      '265/40 R21',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'Black Nova');
    expect(value('Tyre specification')).toBe('265/45 R20');
  });

  it('keeps an owner-picked size when the variant changes', async () => {
    const user = open();
    render(<App />);
    await user.selectOptions(await variantBox(), 'AWD Performance');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Tyre specification' }),
      '265/40 R21',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'RWD Long Range');
    expect(value('Tyre specification')).toBe('265/40 R21');
  });

  it('saves an overridden size', async () => {
    const user = open();
    render(<App />);
    await user.selectOptions(await variantBox(), 'AWD Performance');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model year' }), '2026');
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Tyre specification' }),
      '255/50 R19',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.vehicle?.tyre_spec).toBe('255/50 R19');
    });
  });
});

describe('AC-89: drive follows the variant but stays editable', () => {
  it('fills drive from the variant until the owner changes it', async () => {
    const user = open();
    render(<App />);
    await user.selectOptions(await variantBox(), 'RWD Standard Range');
    expect(value('Drive')).toBe('RWD');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Drive' }), 'AWD');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'RWD Long Range');
    expect(value('Drive')).toBe('AWD');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model year' }), '2026');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fake.vehicle?.variant).toBe('RWD Long Range (2026)');
    });
    expect(fake.vehicle?.drive).toBe('AWD');
  });
});

describe('AC-90: an existing profile is read back without losing values', () => {
  it('reads a saved catalogue variant, year, drive and size back into the form', async () => {
    await seedVehicle({ variant: 'AWD Performance (2025)', tyre_spec: '265/40 R21' });
    open();
    render(<App />);
    await variantBox();
    await waitFor(() => {
      expect(value('Variant')).toBe('AWD Performance');
    });
    expect(value('Model year')).toBe('2025');
    expect(value('Drive')).toBe('AWD');
    expect(value('Tyre specification')).toBe('265/40 R21');
  });

  it('keeps an older free-text variant and tyre value as "Current" options', async () => {
    await seedVehicle({ variant: 'Old text', tyre_spec: '999/99 R99 test' });
    const user = open();
    render(<App />);
    await variantBox();
    await waitFor(() => {
      expect(value('Variant')).toBe('Old text');
    });
    expect(options('Variant')).toContain('Current: Old text');
    expect(value('Tyre specification')).toBe('999/99 R99 test');
    expect(options('Tyre specification')).toContain('Current: 999/99 R99 test');
    expect(screen.queryByRole('combobox', { name: 'Model year' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Vehicle' })).toBeInTheDocument();
    });
    expect(fake.vehicle?.variant).toBe('Old text');
    expect(fake.vehicle?.tyre_spec).toBe('999/99 R99 test');
  });

  it('keeps a saved size that is not in the new variant list when the variant changes', async () => {
    await seedVehicle({ variant: 'Old text', tyre_spec: '999/99 R99 test' });
    const user = open();
    render(<App />);
    await variantBox();
    await waitFor(() => {
      expect(value('Variant')).toBe('Old text');
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Variant' }), 'AWD Performance');
    expect(value('Tyre specification')).toBe('999/99 R99 test');
  });
});

describe('variant text helpers', () => {
  it('appends and parses the model year', () => {
    expect(variantText('AWD Performance', 2025)).toBe('AWD Performance (2025)');
    expect(parseVariant('AWD Performance (2025)')).toEqual({ name: 'AWD Performance', year: 2025 });
    expect(parseVariant('AWD Performance')).toEqual({ name: 'AWD Performance', year: null });
    expect(parseVariant('Black Nova (2025)')).toBeNull(); // not a listed year
    expect(parseVariant('Something else (2025)')).toBeNull();
  });
});
