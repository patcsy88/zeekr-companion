import { defineConfig, devices } from '@playwright/test';

// README screenshots (npm run screenshots). Not part of the e2e gate and not run in CI.
// No API or database: every /api and /health request is answered by the script with made-up data.
const PORT = Number(process.env.SHOTS_WEB_PORT ?? 4175);

export default defineConfig({
  testDir: './screenshots',
  testMatch: '**/*.shots.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, // sharp on a retina screen, half the file size of 3x
    baseURL: `http://localhost:${PORT}`,
    timezoneId: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    serviceWorkers: 'block', // so page.route sees every request
  },
  webServer: {
    command: `npx vite preview --strictPort --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
