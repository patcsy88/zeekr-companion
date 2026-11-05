import { useEffect, useRef } from 'react';
import { openSentryEvents, request } from '../api/client';
import type { SentryState } from '../api/types';

export interface PushedSentry {
  on: boolean;
  at: string;
}

const IDLE_MS = 60_000; // the server sends a keepalive about every 20 s
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;

function parse(block: string): PushedSentry | null {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (event !== 'sentry' || data === '') return null;
  try {
    const v = JSON.parse(data) as { state?: unknown; at?: unknown };
    if ((v.state !== 'on' && v.state !== 'off') || typeof v.at !== 'string') return null;
    return { on: v.state === 'on', at: v.at };
  } catch {
    return null;
  }
}

/**
 * Keeps the Sentry switch in step with a send made from another page (ADR-010). While the page is
 * visible and signed in it holds one stream open; whenever it becomes visible, loads or reconnects
 * it also asks for the last known state once, because a phone suspends streams in the background.
 * It never causes a read of the car.
 */
export function useSentryPush(active: boolean, onState: (s: PushedSentry) => void): void {
  const handler = useRef(onState);
  useEffect(() => {
    handler.current = onState;
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = RETRY_MIN_MS;

    const resync = async () => {
      try {
        const r = await request<SentryState>({ method: 'GET', path: '/vehicle/sentry/state' });
        if (!stopped && r.data.state !== null && r.data.at !== null) {
          handler.current({ on: r.data.state === 'on', at: r.data.at });
        }
      } catch {
        // The stream or the next visit tries again; the switch keeps what it shows.
      }
    };

    const close = () => {
      clearTimeout(retry);
      controller?.abort();
      controller = null;
    };

    const open = async () => {
      close();
      if (stopped || document.visibilityState !== 'visible') return;
      const mine = new AbortController();
      controller = mine;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(idle);
        idle = setTimeout(() => {
          mine.abort();
        }, IDLE_MS);
      };
      try {
        arm();
        const res = await openSentryEvents(mine.signal);
        if (res.body === null) return;
        delay = RETRY_MIN_MS;
        void resync();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let at = buffer.indexOf('\n\n');
          while (at >= 0) {
            const parsed = parse(buffer.slice(0, at));
            buffer = buffer.slice(at + 2);
            if (parsed) handler.current(parsed);
            at = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Falls through to a retry unless this page stopped or was hidden.
      } finally {
        clearTimeout(idle);
      }
      if (stopped || (mine.signal.aborted && controller !== mine)) return;
      if (document.visibilityState !== 'visible') return;
      retry = setTimeout(() => {
        void open();
      }, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void resync();
        void open();
      } else {
        close();
      }
    };

    void resync();
    void open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      close();
    };
  }, [active]);
}
