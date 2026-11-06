export type TabIconName =
  'service' | 'reminders' | 'expenses' | 'warranty' | 'sentry' | 'geofence' | 'vehicle';

const PATHS: Record<TabIconName, string> = {
  service:
    'M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.3-.4-.4-2.3z',
  reminders: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0',
  expenses:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.8 9.2c-.5-.8-1.5-1.2-2.8-1.2-1.5 0-2.6.7-2.6 1.8 0 2.7 5.4 1.2 5.4 3.9 0 1.1-1.1 1.8-2.8 1.8-1.4 0-2.5-.5-3-1.4M12 6.5V8m0 8v1.5',
  warranty: 'M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6zM8.8 12l2.2 2.2 4.2-4.4',
  sentry:
    'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  geofence:
    'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  vehicle:
    'M5 16.5V13l1.6-4.6A2 2 0 0 1 8.5 7h7a2 2 0 0 1 1.9 1.4L19 13v3.5M3.5 13h17M5 16.5v2h3v-2M16 16.5v2h3v-2M7.5 15h.01M16.5 15h.01',
};

/** A decorative icon: the tab's text label is what names the link. */
export function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg
      className="tab-icon"
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
