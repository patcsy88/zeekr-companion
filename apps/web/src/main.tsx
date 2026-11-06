import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initSentry } from './lib/observability';
import { applyTheme, readTheme } from './lib/theme';
import './styles.css';

applyTheme(readTheme()); // before the first render, so the page does not flash the other theme
initSentry(import.meta.env.VITE_SENTRY_DSN as string | undefined);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
