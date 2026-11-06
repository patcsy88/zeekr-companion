import { useState } from 'react';
import { readTheme, saveTheme, THEMES, type Theme } from '../lib/theme';

const LABEL: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

/** Appearance: Auto (follows the phone), Light or Dark. Saved on this device only. */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  return (
    <div className="theme-picker">
      <label htmlFor="theme" className="sr-only">
        Appearance
      </label>
      <select
        id="theme"
        value={theme}
        onChange={(e) => {
          const next = e.target.value as Theme;
          setTheme(next);
          saveTheme(next);
        }}
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {LABEL[t]}
          </option>
        ))}
      </select>
    </div>
  );
}
