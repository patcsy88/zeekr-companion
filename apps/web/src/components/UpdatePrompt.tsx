import { useRegisterSW } from 'virtual:pwa-register/react';

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
    <div className="update" role="status">
      <span>New version available.</span>
      <button
        type="button"
        className="primary"
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        Reload
      </button>
    </div>
  );
}
