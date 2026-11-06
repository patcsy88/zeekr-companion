import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemePicker } from '../src/components/ThemePicker';
import { applyTheme, readTheme, saveTheme, THEME_KEY } from '../src/lib/theme';

function addBarTags() {
  for (const media of ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.setAttribute('media', media);
    document.head.appendChild(meta);
  }
}

function barColours() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (m) => m.content,
  );
}

afterEach(() => {
  localStorage.removeItem(THEME_KEY);
  document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.remove();
  });
});

describe('theme', () => {
  it('follows the phone by default and ignores an unknown stored value', () => {
    expect(readTheme()).toBe('system');
    localStorage.setItem(THEME_KEY, 'purple');
    expect(readTheme()).toBe('system');
  });

  it('saves light or dark, and Auto removes the saved choice', () => {
    saveTheme('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    saveTheme('light');
    expect(readTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    saveTheme('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sets the browser bar colour to the chosen theme, or per phone setting on Auto', () => {
    addBarTags();
    applyTheme('dark');
    expect(barColours()).toEqual(['#0f1514', '#0f1514']);
    applyTheme('light');
    expect(barColours()).toEqual(['#0f5e57', '#0f5e57']);
    applyTheme('system');
    expect(barColours()).toEqual(['#0f5e57', '#0f1514']);
  });

  it('the icon button shows the saved choice and taps through Auto, Light, Dark', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    const user = userEvent.setup();
    render(<ThemePicker />);
    const button = screen.getByRole('button', { name: 'Appearance: Dark' });
    await user.click(button);
    expect(button).toHaveAccessibleName('Appearance: Auto');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    await user.click(button);
    expect(button).toHaveAccessibleName('Appearance: Light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(button);
    expect(button).toHaveAccessibleName('Appearance: Dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
