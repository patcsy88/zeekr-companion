import { useRef, useState } from 'react';
import { ApiError, request } from '../api/client';
import type { SentryCommandResult } from '../api/types';

// The server waits about 15 seconds for the car to report, so the request may take longer than
// the default timeout.
const SEND_TIMEOUT_MS = 45_000;

type Phase = 'idle' | 'confirm' | 'sending';

/**
 * The one command the app can send to the car (ADR-010): Sentry on or off. It always asks first,
 * sends once, and shows what the car reported afterwards, never an assumption that it worked.
 * Text from the server is never shown, only fixed wording.
 */
export function SentryControl({
  current,
  onResult,
  onSeen,
}: {
  current: boolean | null;
  /** The state the car reported after a send, so the page can show it before the next card
   * reading arrives. */
  onSeen: (on: boolean) => void;
  /** The outcome text is shown by the parent, so it survives this control being unmounted when
   * the app goes offline mid-send. */
  onResult: (text: string | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const inflight = useRef(false);

  if (current === null) {
    return (
      <p className="muted small" data-testid="sentry-unknown">
        Sentry can be switched here once the car reports its state.
      </p>
    );
  }
  const desired = current ? 'off' : 'on';

  const send = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setPhase('sending');
    onResult(null);
    try {
      const r = await request<SentryCommandResult>({
        method: 'POST',
        path: '/vehicle/sentry',
        body: { desired },
        timeoutMs: SEND_TIMEOUT_MS,
      });
      const after = r.data.state_after;
      if (after !== null) onSeen(after === 'on');
      onResult(
        r.data.confirmed
          ? `The car reports Sentry ${after ?? desired}.`
          : after === null
            ? 'The command was sent, but the car has not reported the state yet. Refresh in a minute.'
            : `The command was sent, but the car still reports Sentry ${after}. Refresh in a minute.`,
      );
    } catch (e) {
      onResult(
        e instanceof ApiError && e.status === 409
          ? 'A Sentry command is already in progress, or one was sent a moment ago. Try again in a minute.'
          : e instanceof ApiError && e.status === 502
            ? 'The car did not accept the command, or could not be reached. Nothing was changed by this app.'
            : e instanceof ApiError && e.status === 404
              ? 'Live vehicle readings are off.'
              : 'Could not tell whether the command reached the car. Check the car before trying again.',
      );
    } finally {
      inflight.current = false;
      setPhase('idle');
    }
  };

  return (
    <div data-testid="sentry-control">
      {phase === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            onResult(null);
            setPhase('confirm');
          }}
        >
          Turn Sentry {desired}
        </button>
      ) : null}
      {phase === 'confirm' ? (
        <div role="group" aria-label="Confirm Sentry command" className="notice info">
          <p>
            This sends a real command to the car: Sentry {desired}. It is sent once, and the page
            then shows what the car reports.
          </p>
          <button type="button" className="primary" onClick={() => void send()}>
            Send Sentry {desired}
          </button>{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setPhase('idle');
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {phase === 'sending' ? (
        <p role="status" data-testid="sentry-sending">
          Sent. Waiting for the car to report (about 15 seconds)…
        </p>
      ) : null}
    </div>
  );
}
