import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_CSP, PRODUCTION_HEADERS } from '../csp';

// infra/ is only read, never changed from here.
const caddyfile = readFileSync(
  resolve(process.cwd(), '../../infra/Caddyfile') /* vitest runs in apps/web */,
  'utf8',
);

function caddyHeader(name: string): string {
  const m = new RegExp(`^\\s*${name}\\s+"([^"]*)"`, 'm').exec(caddyfile);
  if (!m?.[1]) throw new Error(`${name} not found in infra/Caddyfile`);
  return m[1];
}

describe('e2e CSP matches infra/Caddyfile', () => {
  it('Content-Security-Policy is identical', () => {
    expect(PRODUCTION_CSP).toBe(caddyHeader('Content-Security-Policy'));
  });
  it('the other security headers are identical', () => {
    for (const [k, v] of Object.entries(PRODUCTION_HEADERS)) expect(v).toBe(caddyHeader(k));
  });
});
