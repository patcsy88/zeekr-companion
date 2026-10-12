import { useEffect, useRef, useState } from 'react';
import { signOut } from '../auth/session';
import { useQueueCounts } from '../data/hooks';
import { notifyData } from '../lib/events';
import { clearAllLocalData } from '../storage/db';

/**
 * Two different actions, named for what they do:
 * - "Sign out, keep local data": forgets the token only. Cache and unsent changes stay on the device.
 * - "Sign out and clear local data": also deletes the cache, the queue and the sync markers.
 *   Unsent changes would be lost, so it asks first and says how many.
 */
export function AccountMenu() {
  const { pending, failed } = useQueueCounts();
  const unsent = pending + failed;
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
      await clearAllLocalData();
      signOut();
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
      <div className="account">
        <button type="button" className="link" onClick={signOut}>
          Sign out, keep local data
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Sign out and clear local data
        </button>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="clear-title"
          aria-describedby="clear-desc"
          className="notice bad"
        >
          <h2 id="clear-title">Clear local data and sign out?</h2>
          <p id="clear-desc">
            This removes the service records and vehicle saved on this device. They stay on the
            server.
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
          <div className="actions">
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void clearAndSignOut()}
            >
              Clear local data and sign out
            </button>
            <button
              type="button"
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
