import { useEffect, useRef, useState } from 'react';
import { signOut } from '../auth/session';
import { useQueueCounts } from '../data/hooks';
import { withCacheLock } from '../data/repository';
import { bumpEpoch, notifyData } from '../lib/events';
import { clearAllLocalData } from '../storage/db';
import { cn } from '../lib/cn';
import { ACTIONS } from './Field';
import { NOTICE } from './ListParts';
import { Button } from './ui/button';

/** The only sign out, labelled "Sign out": clears the cache, the queue and the sync markers. Asks first and says how many unsent changes would be lost. */
export function AccountMenu() {
  const { pending, failed, blocked } = useQueueCounts();
  const unsent = pending + failed + blocked;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  async function clearAndSignOut() {
    setBusy(true);
    setError(null);
    try {
      // Same lock as every cache write: a sync already running cannot write back after the clear.
      await withCacheLock(async () => {
        await clearAllLocalData();
        signOut();
        bumpEpoch();
      });
      notifyData();
      setConfirming(false);
    } catch {
      setError('Could not clear local data. You are still signed in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Sign out
      </Button>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="clear-title"
          aria-describedby="clear-desc"
          className={cn(
            NOTICE.bad,
            'fixed inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] z-30 mx-auto my-0 max-w-xl bg-background shadow-lg dark:bg-card',
          )}
        >
          <h2 id="clear-title" className="text-base">
            Clear local data and sign out?
          </h2>
          <p id="clear-desc">
            This removes the vehicle, service records, reminders, expenses, tyre events and warranty
            coverages and claims saved on this device. They stay on the server.
          </p>
          {unsent > 0 ? (
            <p>
              <strong>
                {unsent} {unsent === 1 ? 'change has' : 'changes have'} not reached the server.
              </strong>{' '}
              Clearing deletes {unsent === 1 ? 'it' : 'them'} for good.
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className={cn(ACTIONS, 'mt-3')}>
            <Button
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => void clearAndSignOut()}
            >
              Clear local data and sign out
            </Button>
            <Button
              variant="outline"
              size="lg"
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
