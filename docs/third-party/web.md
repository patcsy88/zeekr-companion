# Web (npm) components

Declared in `apps/web/package.json`; versions are from `apps/web/package-lock.json` (2026-11-21). Every version is pinned exactly.

## Shipped in the app

| Component                  | Version | Licence    | Used for                         |
| -------------------------- | ------- | ---------- | -------------------------------- |
| react                      | 19.3.0  | MIT        | The UI                           |
| react-dom                  | 19.3.0  | MIT        | The UI                           |
| react-router-dom           | 7.18.4  | MIT        | Page routing                     |
| @base-ui/react             | 1.9.0   | MIT        | Accessible UI parts              |
| @sentry/browser            | 11.9.0  | MIT        | Optional browser error reporting |
| idb                        | 8.0.4   | ISC        | Offline storage (IndexedDB)      |
| class-variance-authority   | 0.7.1   | Apache-2.0 | Button and component styles      |
| clsx                       | 2.1.1   | MIT        | Class names                      |
| tailwind-merge             | 3.7.0   | MIT        | Class names                      |
| @fontsource-variable/inter | 5.3.0   | OFL-1.1    | The Inter font                   |

## Build and test only

| Component                   | Version | Licence    | Used for                                                |
| --------------------------- | ------- | ---------- | ------------------------------------------------------- |
| vite                        | 8.3.4   | MIT        | Dev server and build                                    |
| @vitejs/plugin-react        | 6.1.2   | MIT        | React in Vite                                           |
| tailwindcss                 | 4.3.5   | MIT        | Styling                                                 |
| @tailwindcss/vite           | 4.3.5   | MIT        | Tailwind in Vite                                        |
| vite-plugin-pwa             | 2.0.0   | MIT        | Builds the service worker                               |
| workbox-build               | 7.4.1   | MIT        | Precache list for the service worker                    |
| workbox-core                | 7.4.1   | MIT        | Imported by our `src/sw.ts` (added 2026-11-21, ADR-014) |
| workbox-precaching          | 7.4.1   | MIT        | Imported by our `src/sw.ts` (added 2026-11-21, ADR-014) |
| workbox-routing             | 7.4.1   | MIT        | Imported by our `src/sw.ts` (added 2026-11-21, ADR-014) |
| workbox-window              | 7.4.1   | MIT        | Service worker registration in the page                 |
| typescript                  | 6.0.3   | Apache-2.0 | Type checks                                             |
| eslint                      | 9.39.5  | MIT        | Lint                                                    |
| @eslint/js                  | 9.39.5  | MIT        | Lint rules                                              |
| typescript-eslint           | 8.71.1  | MIT        | Lint rules for TypeScript                               |
| eslint-plugin-jsx-a11y      | 6.10.2  | MIT        | Lint rules for accessibility                            |
| eslint-plugin-react-hooks   | 7.1.1   | MIT        | Lint rules for hooks                                    |
| globals                     | 17.13.0 | MIT        | Lint globals                                            |
| prettier                    | 3.9.10  | MIT        | Formatting                                              |
| vitest                      | 5.0.3   | MIT        | Unit and component tests                                |
| @vitest/coverage-v8         | 5.0.3   | MIT        | Coverage (floors 87 / 82 / 84 / 90)                     |
| jsdom                       | 30.1.2  | MIT        | Browser stand-in for tests                              |
| msw                         | 3.0.3   | MIT        | Fake API in tests                                       |
| fake-indexeddb              | 6.2.5   | Apache-2.0 | Fake offline storage in tests                           |
| @testing-library/dom        | 10.4.2  | MIT        | Test helpers                                            |
| @testing-library/react      | 16.3.3  | MIT        | Test helpers                                            |
| @testing-library/jest-dom   | 7.0.1   | MIT        | Test helpers                                            |
| @testing-library/user-event | 14.6.7  | MIT        | Test helpers                                            |
| @playwright/test            | 1.64.0  | Apache-2.0 | End-to-end tests (Chromium and WebKit)                  |
| @types/node                 | 26.6.5  | MIT        | Types                                                   |
| @types/react                | 19.3.0  | MIT        | Types                                                   |
| @types/react-dom            | 19.3.0  | MIT        | Types                                                   |

## Also in the full tree (not direct, not shipped)

| Component                                | Licence   | Note                             |
| ---------------------------------------- | --------- | -------------------------------- |
| lightningcss (and its platform packages) | MPL-2.0   | Used by Tailwind at build time   |
| axe-core                                 | MPL-2.0   | Accessibility checks in tests    |
| caniuse-lite                             | CC-BY-4.0 | Browser data used by build tools |
