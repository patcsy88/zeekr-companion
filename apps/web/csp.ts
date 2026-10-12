/**
 * The Content-Security-Policy and companion headers that infra/Caddyfile sends in production,
 * copied character for character. vite preview serves them too, so every e2e test runs under the
 * production policy. test/csp-drift.test.ts fails if infra/Caddyfile changes and this does not.
 */
export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const PRODUCTION_HEADERS: Record<string, string> = {
  'Content-Security-Policy': PRODUCTION_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
