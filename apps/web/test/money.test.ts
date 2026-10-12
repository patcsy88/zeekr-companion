import { describe, expect, it } from 'vitest';
import { formatMyr, parseMyrToSen, senToInput } from '../src/lib/money';

describe('money', () => {
  it.each([
    ['120.50', 12050],
    ['120.5', 12050],
    ['120', 12000],
    ['0', 0],
    ['0.07', 7],
    ['1,234.56', 123456],
    ['RM 10', 1000],
    ['19.99', 1999],
    ['1.15', 115],
  ])('parses %s to %i sen exactly', (input, sen) => {
    expect(parseMyrToSen(input)).toEqual({ ok: true, minor: sen });
  });

  it.each(['', 'abc', '-1', '1.234', '1,23', '1e3', '10.', '.5'])('rejects %j', (input) => {
    expect(parseMyrToSen(input).ok).toBe(false);
  });

  it('rejects amounts above the contract limit of 10^12 sen', () => {
    expect(parseMyrToSen('10000000000.00')).toEqual({ ok: true, minor: 1_000_000_000_000 });
    expect(parseMyrToSen('10000000000.01').ok).toBe(false);
  });

  it('formats', () => {
    expect(formatMyr(123456)).toBe('RM 1,234.56');
    expect(senToInput(12005)).toBe('120.05');
  });
});
