import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 18765);
// Random per run, shared with the stack process through the environment.
process.env.E2E_PASSWORD ??=
  'e2e-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/stack.mjs',
    url: `http://localhost:${WEB_PORT}/`,
    reuseExistingServer: false,
    // SIGTERM (not the default SIGKILL) lets stack.mjs remove its throwaway Postgres container.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
    timeout: 120_000,
    env: {
      E2E_PASSWORD: process.env.E2E_PASSWORD,
      E2E_WEB_PORT: String(WEB_PORT),
      E2E_API_PORT: String(API_PORT),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(smoke|csp)\.spec\.ts/,
    },
    // Same stack, production CSP from infra/Caddyfile; fails on any CSP violation.
    { name: 'chromium-csp', use: { ...devices['Desktop Chrome'] }, testMatch: /csp\.spec\.ts/ },
    { name: 'webkit-smoke', use: { ...devices['Desktop Safari'] }, testMatch: /smoke\.spec\.ts/ },
  ],
});
