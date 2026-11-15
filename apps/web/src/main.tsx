import { StrictMode } from 'react';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initSentry } from './lib/observability';
import { applyTheme, readTheme } from './lib/theme';
import '@fontsource-variable/inter/wght.css';
import './app.css';

applyTheme(readTheme()); // before the first render, so the page does not flash the other theme
initSentry(import.meta.env.VITE_SENTRY_DSN as string | undefined);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    {/* No inline <style> tags under the production CSP; their CSS is in app.css. */}
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
