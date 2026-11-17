import { useEffect, useState, type FormEvent } from 'react';
import { request } from '../api/client';
import type { GeofenceOption, GeofenceSettings } from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import { ACTIONS, ERROR, FORM, HINT, TextField } from '../components/Field';
import { MUTED, NOTICE } from '../components/ListParts';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { Checkbox } from '../components/ui/checkbox';
import { GeofenceMapCard } from '../components/GeofenceMapCard';

interface Form {
  radius: string;
  interval: string;
  stale: string;
  usage: number[];
}

function toForm(g: GeofenceSettings): Form {
  const s = g.settings;
  return {
    radius: String(s.radius_km),
    interval: String(s.interval_minutes),
    stale: String(s.stale_minutes),
    usage: s.usage_mode_codes,
  };
}

function whole(text: string): number {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

function StateGroup(props: {
  options: GeofenceOption[];
  chosen: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 font-medium text-base/4.5 text-foreground sm:text-sm/4">
        Vehicle State(s)
      </legend>
      {props.options.map((o) => (
        <label
          key={o.code}
          className="m-0 flex min-h-11 items-center gap-3 font-normal text-foreground"
        >
          <Checkbox
            checked={props.chosen.includes(o.code)}
            onCheckedChange={(checked) => {
              props.onChange(
                checked ? [...props.chosen, o.code] : props.chosen.filter((c) => c !== o.code),
              );
            }}
          />{' '}
          {o.label}
        </label>
      ))}
      <p className={HINT}>
        Pick one or both. No other state counts. The state names come from a public integration and
        are not yet confirmed on this car.
      </p>
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
        <p className={MUTED}>
          The geofence map and settings need a sign-in and a connection to the server.
        </p>
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
    if (f.usage.length < 1 || f.usage.length > limits.max_codes)
      return 'Pick Deep Sleep, Parked or both.';
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
    <section aria-labelledby="geo-title" className={FORM}>
      <h1 id="geo-title" className="m-0">
        Geofence
      </h1>
      <p className={HINT}>
        These settings decide when the app shows a notice. It never sends anything to the car. Your
        home address stays on the host and is not shown here.
      </p>
      <GeofenceMapCard />
      {data ? (
        <p className={HINT} data-testid="geo-status">
          Geofence: {data.enabled ? 'on' : 'off'} (set on the host). Home point:{' '}
          {data.home_set ? 'set' : 'not set'}. Values from:{' '}
          {data.sources.radius_km === 'saved' ? 'saved settings' : 'the host'}.
        </p>
      ) : null}
      {aboveLimit && limits ? (
        <p role="status" className={HINT} data-testid="geo-above-limit">
          The host stale limit is {data?.settings.stale_minutes} minutes, above the tab&apos;s
          maximum of {limits.stale_minutes_max}. It applies until you save.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={cn(NOTICE.info, 'my-0')}>
          {notice}
        </p>
      ) : null}
      {form && limits ? (
        <form className={FORM} onSubmit={(e) => void save(e)} noValidate>
          <TextField
            id="geo-radius"
            label="Radius (km)"
            inputMode="decimal"
            value={form.radius}
            onChange={(e) => {
              setForm({ ...form, radius: e.target.value });
            }}
          />
          <TextField
            id="geo-interval"
            label="Check every (minutes)"
            inputMode="numeric"
            value={form.interval}
            onChange={(e) => {
              setForm({ ...form, interval: e.target.value });
            }}
          />
          <TextField
            id="geo-stale"
            label={`Stale limit (minutes, at most ${limits.stale_minutes_max})`}
            inputMode="numeric"
            value={form.stale}
            onChange={(e) => {
              setForm({ ...form, stale: e.target.value });
            }}
          />
          <p className={HINT} data-testid="geo-gear-note">
            Sentry is only turned on when the car is in P (Park).
          </p>
          <StateGroup
            options={limits.usage_mode_options}
            chosen={form.usage}
            onChange={(usage) => {
              setForm({ ...form, usage });
            }}
          />
          <div className={ACTIONS}>
            <Button type="submit" size="lg" disabled={busy}>
              Save
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={busy || data?.sources.radius_km !== 'saved'}
              onClick={() => void reset()}
            >
              Use the host values
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
