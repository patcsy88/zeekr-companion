import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui/button';

/** Service worker updates are not automatic: the user chooses when to reload. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Look for a new version when the app returns to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      className="sticky top-0 z-20 flex items-center justify-center gap-3 border-b bg-background p-2 text-sm"
      role="status"
    >
      <span>New version available.</span>
      <Button
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        Reload
      </Button>
    </div>
  );
}
