import { describe, expect, it } from 'vitest';
import { formatKwh, parseKwhToWh, whToInput } from '../src/lib/energy';

describe('parseKwhToWh', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['42.5', 42500],
    ['42', 42000],
    ['0.001', 1],
    ['0.1', 100],
    ['0.10', 100],
    ['7.125', 7125],
    ['007.5', 7500],
    ['1000', 1_000_000],
    ['1000.000', 1_000_000],
    [' 12.3 ', 12300],
  ])('%j -> %j Wh', (input, wh) => {
    expect(parseKwhToWh(input)).toEqual({ ok: true, wh });
  });

  it.each([
    '0',
    '0.000',
    '-1',
    '1,5',
    '1.2345',
    'abc',
    '1e3',
    '12 kWh',
    '.5',
    '5.',
    '1000.001',
    '99999',
  ])('rejects %j', (input) => {
    expect(parseKwhToWh(input).ok).toBe(false);
  });

  it('never returns a non-integer', () => {
    for (const s of ['0.001', '0.002', '0.003', '1.005', '33.333', '999.999']) {
      const r = parseKwhToWh(s);
      expect(r.ok && Number.isInteger(r.wh)).toBe(true);
    }
  });
});

describe('whToInput and formatKwh', () => {
  it.each([
    [42500, '42.5'],
    [42000, '42'],
    [1, '0.001'],
    [100, '0.1'],
    [7125, '7.125'],
    [1_000_000, '1000'],
  ])('%j Wh -> %j', (wh, text) => {
    expect(whToInput(wh)).toBe(text);
    expect(formatKwh(wh)).toBe(`${text} kWh`);
  });

  it('round-trips every value from 1 to 5000 Wh', () => {
    for (let wh = 1; wh <= 5000; wh++) {
      expect(parseKwhToWh(whToInput(wh))).toEqual({ ok: true, wh });
    }
  });
});
