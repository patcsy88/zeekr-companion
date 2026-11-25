import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { MAIN_TABS, tabFor } from '../src/lib/nav';
import { setToken } from '../src/auth/session';
import { server } from './server';

function open(path: string) {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

describe('AC-107: six main tabs', () => {
  it('lists the tabs left to right', async () => {
    open('/vehicle');
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Vehicle', 'Driving', 'Security', 'Energy', 'Maintenance', 'Setup']);
  });

  it.each([
    ['/vehicle', 'Vehicle'],
    ['/vehicle/live', 'Vehicle'],
    ['/driving', 'Driving'],
    ['/sentry', 'Security'],
    ['/geofence', 'Security'],
    ['/energy', 'Energy'],
    ['/', 'Maintenance'],
    ['/records/new', 'Maintenance'],
    ['/reminders', 'Maintenance'],
    ['/reminders/template', 'Maintenance'],
    ['/expenses', 'Maintenance'],
    ['/warranty', 'Maintenance'],
    ['/vehicle/tyres', 'Maintenance'],
    ['/vehicle/tyres/new', 'Maintenance'],
    ['/advisory', 'Maintenance'],
    ['/setup', 'Setup'],
    ['/setup/renewals', 'Setup'],
    ['/setup/notifications', 'Setup'],
    ['/vehicle/edit', 'Setup'],
  ])('%s keeps %s highlighted', async (path, label) => {
    open(path);
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual([label]);
  });

  it('gives every route to one tab only', () => {
    for (const path of ['/', '/vehicle', '/vehicle/live', '/vehicle/edit', '/vehicle/tyres/x']) {
      expect(MAIN_TABS.filter((t) => t.owns(path))).toHaveLength(1);
    }
    expect(tabFor('/nowhere')).toBeUndefined();
  });

  it('shows the sub-tabs on a list page and not on a form', async () => {
    open('/geofence');
    const { unmount } = render(<App />);
    const row = await screen.findByRole('navigation', { name: 'Security pages' });
    expect(
      within(row)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Sentry', 'Geofence']);
    unmount();
    open('/records/new');
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('navigation', { name: 'Maintenance pages' })).toBeNull();
  });

  it('has Maintenance sub-tabs in order and none on Driving or Energy', async () => {
    open('/');
    const { unmount } = render(<App />);
    const row = await screen.findByRole('navigation', { name: 'Maintenance pages' });
    expect(
      within(row)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Service', 'Reminders', 'Expenses', 'Warranty', 'Tyres', 'Advisory']);
    unmount();
    open('/driving');
    render(<App />);
    await screen.findByRole('heading', { name: 'Driving' });
    expect(screen.queryByRole('navigation', { name: 'Driving pages' })).toBeNull();
  });

  it('Setup shows the profile and links to Notifications', async () => {
    open('/setup');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeInTheDocument();
    const row = screen.getByRole('navigation', { name: 'Setup pages' });
    expect(within(row).getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'href',
      '/setup/notifications',
    );
  });

  it('Geofence points to Setup for phone alerts and no longer holds the card', async () => {
    // The page loads its settings. A real API error keeps the page online; an unhandled request
    // would mark the server unreachable and hide the link.
    server.use(
      http.get('*/api/v1/geofence/settings', () =>
        HttpResponse.json(
          { error: { code: 'internal_error', message: 'Not needed here.', details: [] } },
          { status: 500 },
        ),
      ),
    );
    open('/geofence');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Geofence' })).toBeInTheDocument();
    expect(screen.queryByTestId('push-card')).toBeNull();
    expect(await screen.findByRole('link', { name: 'Setup, Notifications' })).toHaveAttribute(
      'href',
      '/setup/notifications',
    );
  });

  it('Vehicle points to Setup when there is no profile', async () => {
    open('/vehicle');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Setup', hidden: false })).toBeInTheDocument();
  });
});
