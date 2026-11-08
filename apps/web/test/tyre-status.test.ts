import { describe, expect, it } from 'vitest';
import type { TyreEvent } from '../src/api/types';
import { overlayTyreEvents } from '../src/data/tyreEventOverlay';
import type { QueueEntry } from '../src/storage/db';
import { currentTyres } from '../src/lib/tyreStatus';
import { wheelsText } from '../src/lib/tyreText';

const STAMP = '2026-10-01T00:00:00Z';
const ALL = ['driver_front', 'passenger_front', 'driver_rear', 'passenger_rear'] as const;
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function ev(n: number, over: Partial<TyreEvent> = {}): TyreEvent {
  return {
    id: id(n),
    date: '2026-01-01',
    kind: 'replace',
    wheels: [...ALL],
    odometer: 1000,
    brand: 'B',
    model: 'M',
    size: 'S',
    cost_minor: null,
    currency: 'MYR',
    shop: null,
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}
const by = (list: ReturnType<typeof currentTyres>, w: string) => list.find((s) => s.wheel === w)!;

describe('currentTyres (AC-80)', () => {
  it('has the four wheels in the fixed order, all empty without events', () => {
    const s = currentTyres([], 5000);
    expect(s.map((x) => x.wheel)).toEqual([...ALL]);
    for (const x of s) {
      expect(x.replaced).toBeNull();
      expect(x.rotated).toBeNull();
      expect(x.kmSinceReplace).toBeNull();
    }
  });

  it('takes the latest Replace per wheel and the latest Rotate, with km since', () => {
    const events = [
      ev(1, { date: '2025-01-01', odometer: 100 }),
      ev(2, { date: '2026-02-01', odometer: 8000, wheels: ['driver_front', 'passenger_front'] }),
      ev(3, {
        kind: 'rotate',
        brand: null,
        model: null,
        size: null,
        odometer: 9000,
        date: '2026-03-01',
      }),
      ev(4, {
        kind: 'repair',
        brand: null,
        model: null,
        size: null,
        odometer: 9500,
        date: '2026-04-01',
      }),
    ];
    const s = currentTyres(events, 10_000);
    expect(by(s, 'driver_front').replaced?.id).toBe(id(2));
    expect(by(s, 'driver_front').kmSinceReplace).toBe(2000);
    expect(by(s, 'driver_rear').replaced?.id).toBe(id(1));
    expect(by(s, 'driver_rear').kmSinceReplace).toBe(9900);
    expect(by(s, 'passenger_rear').rotated?.id).toBe(id(3));
    expect(by(s, 'passenger_rear').kmSinceRotate).toBe(1000);
  });

  it('ignores Repair, Alignment and Balancing', () => {
    const events = (['repair', 'alignment', 'balancing'] as const).map((k, i) =>
      ev(i + 1, { kind: k, brand: null, model: null, size: null }),
    );
    for (const x of currentTyres(events, 5000)) {
      expect(x.replaced).toBeNull();
      expect(x.rotated).toBeNull();
    }
  });

  it('hides km since when the odometer is unknown or below the event odometer', () => {
    const events = [ev(1, { odometer: 5000 })];
    expect(by(currentTyres(events, null), 'driver_front').kmSinceReplace).toBeNull();
    expect(by(currentTyres(events, 4999), 'driver_front').kmSinceReplace).toBeNull();
    expect(by(currentTyres(events, 5000), 'driver_front').kmSinceReplace).toBe(0);
  });

  it('on the same date the larger odometer wins, then the later created time', () => {
    const a = ev(1, { odometer: 2000, brand: 'Low' });
    const b = ev(2, { odometer: 3000, brand: 'High' });
    expect(by(currentTyres([b, a], 5000), 'driver_front').replaced?.brand).toBe('High');
    expect(by(currentTyres([a, b], 5000), 'driver_front').replaced?.brand).toBe('High');
    const c = ev(3, { odometer: 3000, brand: 'Later', created_at: '2026-10-02T00:00:00Z' });
    expect(by(currentTyres([c, b], 5000), 'driver_front').replaced?.brand).toBe('Later');
  });
});

describe('wheelsText', () => {
  it('says All four, or lists the wheels in the fixed order', () => {
    expect(wheelsText([...ALL])).toBe('All four');
    expect(wheelsText(['driver_rear', 'driver_front'])).toBe('Driver front, Driver rear');
  });
});

function entry(over: Partial<QueueEntry>): QueueEntry {
  return {
    seq: 1,
    id: id(9),
    kind: 'create-tyre-event',
    method: 'POST',
    path: '/tyre-events',
    body: undefined,
    record_id: id(9),
    created_at: STAMP,
    attempts: 0,
    status: 'pending',
    last_error: null,
    next_attempt_at: 0,
    ...over,
  };
}

describe('overlayTyreEvents (AC-81)', () => {
  it('shows an unsent create as pending with null optional fields', () => {
    const body = { id: id(9), date: '2026-05-01', kind: 'rotate', wheels: [...ALL], odometer: 7 };
    const [v] = overlayTyreEvents([], [entry({ body })]);
    expect(v?.sync).toBe('pending');
    expect(v?.event).toMatchObject({
      kind: 'rotate',
      brand: null,
      cost_minor: null,
      currency: 'MYR',
    });
  });

  it('applies an unsent edit without nulling required fields, and hides a pending delete', () => {
    const cached = [ev(1), ev(2, { date: '2026-02-01' })];
    const views = overlayTyreEvents(cached, [
      entry({
        kind: 'edit-tyre-event',
        method: 'PATCH',
        record_id: id(1),
        body: { notes: 'x', odometer: undefined, size: null },
      }),
      entry({ seq: 2, kind: 'delete-tyre-event', method: 'DELETE', record_id: id(2) }),
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]?.event).toMatchObject({ notes: 'x', odometer: 1000, size: null });
    expect(views[0]?.sync).toBe('pending');
  });

  it('sorts newest first', () => {
    const views = overlayTyreEvents(
      [ev(1, { date: '2025-01-01' }), ev(2, { date: '2026-01-01' })],
      [],
    );
    expect(views.map((v) => v.event.id)).toEqual([id(2), id(1)]);
  });
});
