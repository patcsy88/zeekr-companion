export type TabIconName = 'vehicle' | 'driving' | 'security' | 'energy' | 'maintenance' | 'setup';

const PATHS: Record<TabIconName, string> = {
  vehicle:
    'M5 16.5V13l1.6-4.6A2 2 0 0 1 8.5 7h7a2 2 0 0 1 1.9 1.4L19 13v3.5M3.5 13h17M5 16.5v2h3v-2M16 16.5v2h3v-2M7.5 15h.01M16.5 15h.01',
  driving:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 12h7.5M13.5 12H21M12 13.5V21',
  security: 'M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6zM8.8 12l2.2 2.2 4.2-4.4',
  energy: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  maintenance:
    'M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.3-.4-.4-2.3z',
  setup: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
};

/** A decorative icon: the tab's text label is what names the link. */
export function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg
      className="flex-none"
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
      <path d={PATHS[name]} />
    </svg>
  );
}
