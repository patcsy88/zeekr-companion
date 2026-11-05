import { useEffect, useState, type FormEvent } from 'react';
import { request } from '../api/client';
import type { GeofenceOption, GeofenceSettings } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';

interface Form {
  radius: string;
  interval: string;
  stale: string;
  gear: number[];
  usage: number[];
}

function toForm(g: GeofenceSettings): Form {
  const s = g.settings;
  return {
    radius: String(s.radius_km),
    interval: String(s.interval_minutes),
    stale: String(s.stale_minutes),
    gear: s.gear_codes,
    usage: s.usage_mode_codes,
  };
}

function whole(text: string): number {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

function CodeGroup(props: {
  legend: string;
  options: GeofenceOption[];
  chosen: number[];
  max: number;
  onChange: (next: number[]) => void;
}) {
  return (
    <fieldset>
      <legend>{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.code} className="check">
          <input
            type="checkbox"
            checked={props.chosen.includes(o.code)}
            onChange={(e) => {
              props.onChange(
                e.target.checked
                  ? [...props.chosen, o.code]
                  : props.chosen.filter((c) => c !== o.code),
              );
            }}
          />{' '}
          {o.label} ({o.code}){o.verified ? '' : ' - unverified label'}
        </label>
      ))}
      <p className="muted small">Pick 1 to {props.max}.</p>
    </fieldset>
  );
}

export function GeofencePage() {
  const session = useSession();
  const { online } = useConnectivity();
  const [data, setData] = useState<GeofenceSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session.signedIn || !online) return;
    let live = true;
    void (async () => {
      try {
        const r = await request<GeofenceSettings>({ method: 'GET', path: '/geofence/settings' });
        if (!live) return;
        setData(r.data);
        setForm(toForm(r.data));
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load.');
      }
    })();
    return () => {
      live = false;
    };
  }, [session.signedIn, online]);

  if (!session.signedIn || !online) {
    return (
      <section aria-labelledby="geo-title">
        <h1 id="geo-title">Geofence</h1>
        <p className="muted">Geofence settings need a sign-in and a connection to the server.</p>
      </section>
    );
  }

  const limits = data?.limits;

  function problem(f: Form): string | null {
    if (!limits) return 'Settings have not loaded.';
    const radius = Number(f.radius);
    if (!(radius > 0 && radius <= limits.radius_km_max))
      return `Radius must be above 0 and at most ${limits.radius_km_max} km.`;
    const interval = whole(f.interval);
    if (!(interval >= limits.interval_minutes_min && interval <= limits.interval_minutes_max))
      return `Interval must be ${limits.interval_minutes_min} to ${limits.interval_minutes_max} minutes.`;
    const stale = whole(f.stale);
    if (!(stale >= limits.stale_minutes_min && stale <= limits.stale_minutes_max))
      return `Stale limit must be ${limits.stale_minutes_min} to ${limits.stale_minutes_max} minutes. Change the value, then save.`;
    if (f.gear.length < 1 || f.gear.length > limits.max_codes)
      return `Pick 1 to ${limits.max_codes} gear codes.`;
    if (f.usage.length < 1 || f.usage.length > limits.max_codes)
      return `Pick 1 to ${limits.max_codes} usage-mode codes.`;
    return null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const bad = problem(form);
    if (bad) {
      setError(bad);
      setNotice(null);
      return;
    }
    setBusy(true);
    try {
      const r = await request<GeofenceSettings>({
        method: 'PUT',
        path: '/geofence/settings',
        body: {
          radius_km: Number(form.radius),
          interval_minutes: whole(form.interval),
          stale_minutes: whole(form.stale),
          gear_codes: form.gear,
          usage_mode_codes: form.usage,
        },
      });
      setData(r.data);
      setForm(toForm(r.data));
      setError(null);
      setNotice('Saved. It applies at the next check.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const r = await request<GeofenceSettings>({ method: 'DELETE', path: '/geofence/settings' });
      setData(r.data);
      setForm(toForm(r.data));
      setError(null);
      setNotice('Back to the host values.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset.');
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }

  const aboveLimit =
    data && limits ? data.settings.stale_minutes > limits.stale_minutes_max : false;

  return (
    <section aria-labelledby="geo-title">
      <h1 id="geo-title">Geofence</h1>
      <p className="muted small">
        These settings decide when the app shows a notice. It never sends anything to the car. Your
        home address stays on the host and is not shown here.
      </p>
      {data ? (
        <p className="muted small" data-testid="geo-status">
          Geofence: {data.enabled ? 'on' : 'off'} (set on the host). Home point:{' '}
          {data.home_set ? 'set' : 'not set'}. Values from:{' '}
          {data.sources.radius_km === 'saved' ? 'saved settings' : 'the host'}.
        </p>
      ) : null}
      {aboveLimit && limits ? (
        <p role="status" className="muted small" data-testid="geo-above-limit">
          The host stale limit is {data?.settings.stale_minutes} minutes, above the tab&apos;s
          maximum of {limits.stale_minutes_max}. It applies until you save.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {form && limits ? (
        <form onSubmit={(e) => void save(e)} noValidate>
          <label>
            Radius (km)
            <input
              inputMode="decimal"
              value={form.radius}
              onChange={(e) => {
                setForm({ ...form, radius: e.target.value });
              }}
            />
          </label>
          <label>
            Check every (minutes)
            <input
              inputMode="numeric"
              value={form.interval}
              onChange={(e) => {
                setForm({ ...form, interval: e.target.value });
              }}
            />
          </label>
          <label>
            Stale limit (minutes, at most {limits.stale_minutes_max})
            <input
              inputMode="numeric"
              value={form.stale}
              onChange={(e) => {
                setForm({ ...form, stale: e.target.value });
              }}
            />
          </label>
          <CodeGroup
            legend="Gear counts as parked when it is"
            options={limits.gear_options}
            chosen={form.gear}
            max={limits.max_codes}
            onChange={(gear) => {
              setForm({ ...form, gear });
            }}
          />
          <CodeGroup
            legend="Car counts as asleep when usage mode is"
            options={limits.usage_mode_options}
            chosen={form.usage}
            max={limits.max_codes}
            onChange={(usage) => {
              setForm({ ...form, usage });
            }}
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              disabled={busy || data?.sources.radius_km !== 'saved'}
              onClick={() => void reset()}
            >
              Use the host values
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
