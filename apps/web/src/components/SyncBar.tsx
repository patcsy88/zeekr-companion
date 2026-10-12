import {
  useConnectivity,
  useLastSynced,
  useQueueCounts,
  useSession,
  useSyncStatus,
} from '../data/hooks';
import { formatTimestamp } from '../lib/dates';
import { syncAll } from '../sync/engine';

/** Always-visible sync state: offline, pending, failed, last sync, and the Sync now button. */
export function SyncBar() {
  const { online } = useConnectivity();
  const { pending, failed } = useQueueCounts();
  const { flushing, paused } = useSyncStatus();
  const session = useSession();
  const last = useLastSynced();

  return (
    <div className="syncbar" role="region" aria-label="Sync status">
      <ul className="statuses">
        <li>
          {online ? (
            <span className="badge ok">Online</span>
          ) : (
            <span className="badge warn" data-testid="offline-indicator">
              {typeof navigator !== 'undefined' && !navigator.onLine
                ? 'Offline'
                : 'Server unreachable'}
            </span>
          )}
        </li>
        {pending > 0 ? (
          <li>
            <span className="badge info" data-testid="pending-count">
              {pending} waiting to sync
            </span>
          </li>
        ) : null}
        {failed > 0 ? (
          <li>
            <span className="badge bad" data-testid="failed-count">
              {failed} failed
            </span>
          </li>
        ) : null}
        {!session.signedIn ? (
          <li>
            <span className="badge warn">
              {paused || session.needsLogin ? 'Sign in to resume sync' : 'Signed out'}
            </span>
          </li>
        ) : null}
      </ul>
      {!online && pending > 0 ? (
        <p className="muted small">Your changes are saved on this device and will sync later.</p>
      ) : null}
      <p className="muted small" aria-live="polite">
        {flushing ? 'Syncing…' : last ? `Last synced ${formatTimestamp(last)}` : 'Not synced yet'}
      </p>
      <button
        type="button"
        onClick={() => {
          void syncAll(true);
        }}
        disabled={flushing || !session.signedIn}
      >
        Sync now
      </button>
    </div>
  );
}
