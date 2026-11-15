import {
  useConnectivity,
  useLastSynced,
  useQueueCounts,
  useSession,
  useSyncStatus,
} from '../data/hooks';
import { formatTimestamp } from '../lib/dates';
import { syncAll } from '../sync/engine';
import { SMALL } from './ListParts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/** Always-visible sync state: offline, pending, failed, last sync, and the Sync now button. */
export function SyncBar() {
  const { online } = useConnectivity();
  const { pending, failed, blocked } = useQueueCounts();
  const { flushing, paused } = useSyncStatus();
  const session = useSession();
  const last = useLastSynced();

  return (
    <div
      className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 [&_p]:m-0"
      role="region"
      aria-label="Sync status"
    >
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        <li>
          {online ? (
            <Badge variant="success" size="lg">
              Online
            </Badge>
          ) : (
            <Badge variant="warning" size="lg" data-testid="offline-indicator">
              {typeof navigator !== 'undefined' && !navigator.onLine
                ? 'Offline'
                : 'Server unreachable'}
            </Badge>
          )}
        </li>
        {pending > 0 ? (
          <li>
            <Badge variant="info" size="lg" data-testid="pending-count">
              {pending} waiting to sync
            </Badge>
          </li>
        ) : null}
        {failed > 0 ? (
          <li>
            <Badge variant="error" size="lg" data-testid="failed-count">
              {failed} failed
            </Badge>
          </li>
        ) : null}
        {blocked > 0 ? (
          <li>
            <Badge variant="error" size="lg" data-testid="blocked-count">
              {blocked} blocked
            </Badge>
          </li>
        ) : null}
        {!session.signedIn ? (
          <li>
            <Badge variant="warning" size="lg">
              {paused || session.needsLogin ? 'Sign in to resume sync' : 'Signed out'}
            </Badge>
          </li>
        ) : null}
      </ul>
      {!online && pending > 0 ? (
        <p className={SMALL}>Your changes are saved on this device and will sync later.</p>
      ) : null}
      <p className={SMALL} aria-live="polite">
        {flushing ? 'Syncing…' : last ? `Last synced ${formatTimestamp(last)}` : 'Not synced yet'}
      </p>
      <Button
        variant="outline"
        size="lg"
        onClick={() => {
          void syncAll(true);
        }}
        disabled={flushing || !session.signedIn}
      >
        Sync now
      </Button>
    </div>
  );
}
