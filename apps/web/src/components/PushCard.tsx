import { useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import type { PushConfig, PushTest } from '../api/types';
import { Button } from './ui/button';
import { ACTIONS, ERROR, HINT } from './Field';
import { NOTICE } from './ListParts';
import { cn } from '../lib/cn';
import { currentSubscription, permission, pushSupport, turnOff, turnOn } from '../lib/pushClient';

type Phase = 'loading' | 'ready';

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

/** Alerts on this phone (ADR-014). One notification for each new geofence alert. */
export function PushCard() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const supported = pushSupport() === 'supported';

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await request<PushConfig>({ method: 'GET', path: '/push/config' });
        const sub = supported ? await currentSubscription() : null;
        if (!live) return;
        setConfig(r.data);
        setSubscribed(sub !== null);
      } catch (e) {
        if (live) setError(message(e, 'Could not load the alert settings.'));
      } finally {
        if (live) setPhase('ready');
      }
    })();
    return () => {
      live = false;
    };
  }, [supported]);

  async function on() {
    if (!config?.public_key) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await turnOn(config.public_key);
      if (r.result === 'on') {
        setSubscribed(true);
        setConfig({ ...config, devices: r.devices ?? config.devices });
        setNotice('Alerts are on for this phone.');
      } else if (r.result === 'denied') {
        setError('Alerts are blocked for this app. Allow notifications in the phone settings.');
      } else {
        setError('This phone did not give an address for alerts.');
      }
    } catch (e) {
      setError(message(e, 'Could not turn on alerts.'));
    } finally {
      setBusy(false);
    }
  }

  async function off() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const devices = await turnOff();
      setSubscribed(false);
      if (config && devices !== null) setConfig({ ...config, devices });
      setNotice('Alerts are off for this phone.');
    } catch (e) {
      setError(message(e, 'Could not turn off alerts.'));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await request<PushTest>({ method: 'POST', path: '/push/test' });
      setNotice(
        r.data.failed === 0
          ? `Test sent to ${r.data.sent} phone${r.data.sent === 1 ? '' : 's'}.`
          : `Sent to ${r.data.sent}, failed for ${r.data.failed}.`,
      );
    } catch (e) {
      setError(message(e, 'Could not send the test.'));
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = <p className={HINT}>Loading…</p>;
  } else if (!config) {
    body = null;
  } else if (!config.enabled) {
    body = (
      <p className={HINT} data-testid="push-off">
        Alerts are not set up on the host.
      </p>
    );
  } else if (!supported) {
    body = (
      <p className={HINT} data-testid="push-unsupported">
        This browser cannot show alerts. On an iPhone, add the app to the Home Screen and open it
        from there (iOS 16.4 or later).
      </p>
    );
  } else if (!subscribed && permission() === 'denied') {
    body = (
      <p className={HINT} data-testid="push-blocked">
        Alerts are blocked for this app. Allow notifications in the phone settings, then open this
        tab again.
      </p>
    );
  } else {
    body = (
      <div className={ACTIONS}>
        {subscribed ? (
          <>
            <Button variant="outline" size="lg" disabled={busy} onClick={() => void test()}>
              Send a test
            </Button>
            <Button variant="outline" size="lg" disabled={busy} onClick={() => void off()}>
              Turn off alerts
            </Button>
          </>
        ) : (
          <Button size="lg" disabled={busy} onClick={() => void on()}>
            Turn on alerts
          </Button>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="push-title" className="grid gap-2" data-testid="push-card">
      <h2 id="push-title" className="m-0 text-lg">
        Alerts on this phone
      </h2>
      <p className={HINT}>
        One notification when the car is away from home. It never includes a place. Delivery goes
        through your phone maker&apos;s push service and can be delayed.
      </p>
      {config && config.enabled ? (
        <p className={HINT} data-testid="push-devices">
          Phones with alerts on: {config.devices} of {config.max_devices}.
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
      {body}
    </section>
  );
}
