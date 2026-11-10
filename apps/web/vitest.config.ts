import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

process.env.TZ = 'Asia/Kuala_Lumpur'; // inherited by the test workers

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': new URL('./test/pwa-stub.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    // Full-UI tests type into forms with userEvent; under parallel load they can pass 5 s.
    testTimeout: 15000,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // main.tsx only mounts <App />; it runs in the browser, not under jsdom.
      exclude: ['src/main.tsx'],
      reporter: ['text-summary', 'text'],
      // Floors just below the 2026-11-10 baseline (87.57 / 82.56 / 84.7 / 90.71). Raise them, never lower them.
      thresholds: { statements: 87, branches: 82, functions: 84, lines: 90 },
    },
  },
});
