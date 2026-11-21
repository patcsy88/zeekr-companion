import type { TabIconName } from '../components/TabIcon';

export interface SubTab {
  to: string;
  label: string;
}

export interface MainTab {
  key: TabIconName;
  label: string;
  /** Where the tab button goes. */
  to: string;
  /** True when a path belongs to this tab, so it stays highlighted on all of its pages. */
  owns: (path: string) => boolean;
  /** Sub-tab row, shown on the list pages only. Empty when the tab has one page. */
  subs: SubTab[];
}

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

export const MAIN_TABS: MainTab[] = [
  {
    key: 'vehicle',
    label: 'Vehicle',
    to: '/vehicle',
    owns: (p) => p === '/vehicle' || p === '/vehicle/live',
    subs: [
      { to: '/vehicle', label: 'Live' },
      { to: '/vehicle/live', label: 'History' },
    ],
  },
  { key: 'driving', label: 'Driving', to: '/driving', owns: (p) => p === '/driving', subs: [] },
  {
    key: 'security',
    label: 'Security',
    to: '/sentry',
    owns: (p) => p === '/sentry' || p === '/geofence',
    subs: [
      { to: '/sentry', label: 'Sentry' },
      { to: '/geofence', label: 'Geofence' },
    ],
  },
  { key: 'energy', label: 'Energy', to: '/energy', owns: (p) => p === '/energy', subs: [] },
  {
    key: 'maintenance',
    label: 'Maintenance',
    to: '/',
    owns: (p) =>
      p === '/' ||
      under(p, '/records') ||
      under(p, '/reminders') ||
      under(p, '/expenses') ||
      under(p, '/warranty') ||
      under(p, '/vehicle/tyres') ||
      under(p, '/advisory'),
    subs: [
      { to: '/', label: 'Service' },
      { to: '/reminders', label: 'Reminders' },
      { to: '/expenses', label: 'Expenses' },
      { to: '/warranty', label: 'Warranty' },
      { to: '/vehicle/tyres', label: 'Tyres' },
      { to: '/advisory', label: 'Advisory' },
    ],
  },
  {
    key: 'setup',
    label: 'Setup',
    to: '/setup',
    owns: (p) => under(p, '/setup') || p === '/vehicle/edit',
    subs: [
      { to: '/setup', label: 'Profile' },
      { to: '/setup/notifications', label: 'Notifications' },
    ],
  },
];

export function tabFor(path: string): MainTab | undefined {
  return MAIN_TABS.find((t) => t.owns(path));
}
