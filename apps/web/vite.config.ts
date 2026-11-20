import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { PRODUCTION_HEADERS } from './csp';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt', // user-confirmed updates: "New version available, reload"
      injectRegister: false,
      strategies: 'injectManifest', // our own src/sw.ts: app shell cache plus push (ADR-014)
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Zeekr Companion',
        short_name: 'Zeekr',
        description: 'Service records and ownership notes for a Zeekr 7X.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // App shell only. sw.ts has no runtime caching, so nothing under /api is ever cached.
        globPatterns: [
          '**/*.{js,css,html,svg,png,webmanifest}',
          '**/inter-latin-wght-normal-*.woff2',
        ],
        // The iPhone launch images are read by iOS when the app is added, not by the app.
        globIgnores: ['splash/**'],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/health': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    headers: PRODUCTION_HEADERS, // same CSP as infra/Caddyfile

    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/health': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: { sourcemap: false },
});
