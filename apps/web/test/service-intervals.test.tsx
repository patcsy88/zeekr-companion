import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { setToken } from '../src/auth/session';
import { formatDate } from '../src/lib/dates';
import { fake, server } from './server';

function open(path = '/') {
  window.history.pushState(null, '', path);
  setToken('tok-test', 3600);
  return userEvent.setup();
}

const withPurchase = (purchase_date: string | null) => {
  fake.vehicle = { id: 'c0000000-0000-4000-8000-000000000001', purchase_date } as never;
};

describe('AC-91: service intervals on the Service tab', () => {
  it('is collapsed, shows the interval, and dates each checkpoint from the purchase date', async () => {
    withPurchase('2025-03-31');
    const user = open();
    render(<App />);
    const card = await screen.findByTestId('service-intervals');
    expect(card.tagName).toBe('DETAILS');
    expect(card).not.toHaveAttribute('open');
    expect(
      within(card).getByText(
        'Service intervals: every 40,000 km or 24 months, whichever comes first',
      ),
    ).toBeInTheDocument();
    await user.click(within(card).getByText(/^Service intervals:/));
    expect(card).toHaveAttribute('open');
    await waitFor(() => {
      expect(within(card).getByText(/Due dates count from the purchase date/)).toHaveTextContent(
        formatDate('2025-03-31'),
      );
    });
    const items = within(within(card).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const dates = items.map((li) => li.querySelector('time')?.getAttribute('dateTime'));
    expect(dates).toEqual(['2027-03-31', '2029-03-31', '2031-03-31', '2033-03-31']);
    expect(items[0]).toHaveTextContent('40,000 km or');
    expect(items[0]).toHaveTextContent('Maintenance inspection; Cabin air filter replacement.');
    expect(items[3]).toHaveTextContent('160,000 km or');
    const source = within(card).getByTestId('intervals-source');
    expect(source).toHaveTextContent('retrieved 2026-11-16');
    expect(source).toHaveTextContent('Confirm against your own booklet or service centre.');
    expect(
      within(source).getByRole('link', {
        name: 'Zeekr Malaysia Service Maintenance Schedule and Pricing (PDF)',
      }),
    ).toHaveAttribute(
      'href',
      'https://assets.zeekrlife.com/assets/my/Service_Maintenance_Schedule_And_Pricing.pdf',
    );
    expect(
      within(card).getByRole('link', { name: 'Set up reminders from this schedule' }),
    ).toHaveAttribute('href', '/reminders/template');
    expect(fake.reminderPosts).toHaveLength(0);
  });

  it('without a purchase date shows months and points to the vehicle profile', async () => {
    withPurchase(null);
    open();
    render(<App />);
    const card = await screen.findByTestId('service-intervals');
    await waitFor(() => {
      expect(within(card).getByRole('link', { name: 'vehicle profile' })).toHaveAttribute(
        'href',
        '/vehicle',
      );
    });
    const items = within(within(card).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('time'))).toEqual([null, null, null, null]);
    expect(items[0]).toHaveTextContent('40,000 km or 24 months');
    expect(items[3]).toHaveTextContent('160,000 km or 96 months');
  });

  it('says the intervals need one online visit when the schedule was never loaded', async () => {
    server.use(
      http.get('*/api/v1/reminder-templates', () =>
        HttpResponse.json({ code: 'internal', message: 'down' }, { status: 500 }),
      ),
    );
    open();
    render(<App />);
    expect(await screen.findByTestId('intervals-not-loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('service-intervals')).not.toBeInTheDocument();
  });

  it('shows no card when the server offers no schedule', async () => {
    fake.templates = [];
    open();
    render(<App />);
    await screen.findByRole('heading', { name: 'Service history' });
    await waitFor(() => {
      expect(screen.queryByTestId('intervals-not-loaded')).not.toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId('service-intervals')).not.toBeInTheDocument();
  });
});
