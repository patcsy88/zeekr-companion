import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import type { AutoSentry, CommandLog, CommandLogItem } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import { formatKl } from '../lib/liveVehicle';
import { Skeleton } from './Skeleton';

const LOG_PATH = '/vehicle/sentry/log?limit=20';
const SHOWN = 3;

/** Fixed wording for one automatic row. Nothing from the server is shown as text. */
export function describeAuto(item: CommandLogItem): string {
  const when = formatKl(item.created_at);
  if (item.result === 'skipped') {
    const why =
      item.skip_reason === 'quiet_period'
        ? 'a command was sent recently'
        : item.skip_reason === 'host_off'
          ? 'the host switch is off'
          : item.skip_reason === 'busy'
            ? 'another Sentry command was in progress'
            : 'a safety check';
    return `Skipped at ${when}: nothing was sent, because ${why}.`;
  }
  if (item.result === 'sent') {
    return item.state_after === 'on'
      ? `Sent at ${when}. The car reports Sentry on.`
      : item.state_after === 'off'
        ? `Sent at ${when}, but the car still reports Sentry off.`
        : `Sent at ${when}. The car has not reported the state.`;
  }
  if (item.result === 'refused') return `The car refused the command at ${when}. Not retried.`;
  return `The command failed at ${when}. Not retried.`;
}

/**
 * Automatic Sentry on (ADR-011), on the Sentry tab. One switch and a quiet period. It sends Sentry
 * on once when a new geofence alert opens, never off, and nothing is retried. The server decides
 * whether it can be turned on; this panel only shows fixed wording.
 */
export function AutoSentryPanel() {
  const session = useSession();
  const { online } = useConnectivity();
  const active = session.signedIn && online;
  const [auto, setAuto] = useState<AutoSentry | null>(null);
  const [rows, setRows] = useState<CommandLogItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [quiet, setQuiet] = useState('60');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await request<AutoSentry>({ method: 'GET', path: '/vehicle/sentry/auto' });
      setAuto(a.data);
      setQuiet(String(a.data.quiet_minutes));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    try {
      const l = await request<CommandLog>({ method: 'GET', path: LOG_PATH });
      setRows(l.data.items.filter((i) => i.source === 'auto').slice(0, SHOWN));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void Promise.resolve().then(load);
  }, [active, load]);

  if (!active) return null;
  if (auto === null) {
    return failed ? (
      <p role="status" className="muted small">
        Could not load the automatic Sentry setting.
      </p>
    ) : (
      <Skeleton />
    );
  }

  const { min, max } = auto.limits.quiet_minutes;
  const minutes = /^\d+$/.test(quiet) ? Number(quiet) : Number.NaN;
  const valid = Number.isInteger(minutes) && minutes >= min && minutes <= max;
  const dirty = valid && minutes !== auto.quiet_minutes;
  const blocked = !auto.enabled && !auto.can_enable;

  async function save(enabled: boolean, quietMinutes: number) {
    setBusy(true);
    setNote(null);
    try {
      const r = await request<AutoSentry>({
        method: 'PUT',
        path: '/vehicle/sentry/auto',
        body: { enabled, quiet_minutes: quietMinutes },
      });
      setAuto(r.data);
      setQuiet(String(r.data.quiet_minutes));
      setNote(
        enabled === auto?.enabled
          ? 'Saved.'
          : enabled
            ? 'Automatic Sentry is on. It sends nothing until a new alert opens.'
            : 'Automatic Sentry is off.',
      );
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 409
          ? 'It cannot be turned on: the host switch, live readings and the geofence must all be on.'
          : e instanceof ApiError && e.status === 400
            ? `The quiet period must be a whole number from ${min} to ${max} minutes.`
            : 'Could not save. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="auto-sentry" className="auto-sentry">
      <h2 className="small">Automatic Sentry on</h2>
      <p className="muted small">
        When a new alert opens, the app sends Sentry on once, without asking. It never sends Sentry
        off, and it does not retry.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={auto.enabled}
        aria-label={`Automatic Sentry on: ${auto.enabled ? 'on' : 'off'}`}
        className={`sentry-switch sentry-switch-${auto.enabled ? 'on' : 'off'}`}
        disabled={busy || blocked}
        data-testid="auto-sentry-switch"
        onClick={() => {
          if (valid) void save(!auto.enabled, minutes);
          else setNote(`The quiet period must be a whole number from ${min} to ${max} minutes.`);
        }}
      >
        <span className="ro-track" aria-hidden="true">
          <span className="ro-knob" />
        </span>
        <span aria-hidden="true">{auto.enabled ? 'On' : 'Off'}</span>
      </button>
      {blocked ? (
        <p className="muted small" data-testid="auto-sentry-blocked">
          It cannot be turned on yet. The host switch, live readings and the geofence must all be
          on.
        </p>
      ) : null}
      <label className="field">
        Quiet period (minutes)
        <input
          type="text"
          inputMode="numeric"
          value={quiet}
          disabled={busy}
          aria-invalid={!valid}
          data-testid="auto-sentry-quiet"
          onChange={(e) => {
            setQuiet(e.target.value);
          }}
        />
      </label>
      <p className="muted small">
        If any Sentry command was logged within this time, the automatic send is skipped. {min} to{' '}
        {max} minutes.
      </p>
      {!valid ? (
        <p role="alert" className="error small">
          Enter a whole number from {min} to {max}.
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || !dirty}
        data-testid="auto-sentry-save"
        onClick={() => void save(auto.enabled, minutes)}
      >
        Save quiet period
      </button>
      {note ? (
        <p role="status" className="notice info" data-testid="auto-sentry-note">
          {note}
        </p>
      ) : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="muted small" data-testid="auto-sentry-none">
          No automatic send yet.
        </p>
      ) : (
        <ul className="list" aria-label="Recent automatic sends" data-testid="auto-sentry-log">
          {rows.map((r) => (
            <li key={r.id} className="small">
              {describeAuto(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
