/**
 * Light / dark appearance chosen in the app. "system" follows the phone setting (the default).
 * Only the choice itself is kept, in localStorage under THEME_KEY: no personal data.
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'zc-theme';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

// The browser bar colours, the same as the theme-color tags in index.html.
const BAR_COLOUR = { light: '#0f5e57', dark: '#0f1514' } as const;

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system'; // storage blocked (private mode): fall back to the phone setting
  }
}

/** Set the attribute the CSS reads, and the browser bar colour. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    const forMedia = media.includes('dark') ? 'dark' : 'light';
    meta.content = BAR_COLOUR[theme === 'system' ? forMedia : theme];
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // not saved; still applied for this visit
  }
  applyTheme(theme);
}
