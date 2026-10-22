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
  },
});
