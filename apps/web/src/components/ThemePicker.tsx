import { useState } from 'react';
import { readTheme, saveTheme, type Theme } from '../lib/theme';

const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {theme === 'light' ? (
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      ) : theme === 'dark' ? (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** Appearance: each tap moves Auto (follows the phone) → Light → Dark. Saved on this device only. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next = NEXT[theme];
  return (
    <button
      type="button"
      className="theme-picker"
      aria-label={`Appearance: ${LABEL[theme]}`}
      title={`Appearance: ${LABEL[theme]}. Tap for ${LABEL[next]}.`}
      onClick={() => {
        setTheme(next);
        saveTheme(next);
      }}
    >
      <ThemeIcon theme={theme} />
    </button>
  );
}
