import { useState } from 'react';
import { signOut } from '../auth/session';
import { useQueueCounts } from '../data/hooks';
import { withCacheLock } from '../data/repository';
import { bumpEpoch, notifyData } from '../lib/events';
import { clearAllLocalData } from '../storage/db';
import { ConfirmDialog } from './ConfirmDialog';
import { ERROR } from './Field';
import { Button } from './ui/button';

/** The only sign out, labelled "Sign out": clears the cache, the queue and the sync markers. Asks first and says how many unsent changes would be lost. */
export function AccountMenu() {
  const { pending, failed, blocked } = useQueueCounts();
  const unsent = pending + failed + blocked;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <ConfirmDialog
        open={confirming}
        title="Clear local data and sign out?"
        description="This removes the vehicle, service records, reminders, expenses, tyre events and warranty coverages and claims saved on this device. They stay on the server."
        confirmLabel="Clear local data and sign out"
        busy={busy}
        onConfirm={() => void clearAndSignOut()}
        onCancel={() => {
          setConfirming(false);
        }}
      >
        {unsent > 0 ? (
          <p className="m-0 text-sm">
            <strong>
              {unsent} {unsent === 1 ? 'change has' : 'changes have'} not reached the server.
            </strong>{' '}
            Clearing deletes {unsent === 1 ? 'it' : 'them'} for good.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={ERROR}>
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
