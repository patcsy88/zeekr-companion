import type { TyreEvent, TyreWheel } from '../api/types';
import { WHEELS } from './tyreText';

export interface WheelStatus {
  wheel: TyreWheel;
  /** The latest Replace that included this wheel, or null. */
  replaced: TyreEvent | null;
  /** Km since that Replace; null when the odometer is unknown or below the event odometer. */
  kmSinceReplace: number | null;
  /** The latest Rotate that included this wheel, or null. */
  rotated: TyreEvent | null;
  kmSinceRotate: number | null;
}

function kmSince(event: TyreEvent | null, current: number | null): number | null {
  if (event === null || current === null || current < event.odometer) return null;
  return current - event.odometer;
}

/** Later date wins, then the larger odometer, then created time, then id. */
function isLater(a: TyreEvent, b: TyreEvent): boolean {
  if (a.date !== b.date) return a.date > b.date;
  if (a.odometer !== b.odometer) return a.odometer > b.odometer;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

/** "Current tyres" (AC-80): computed on the device from the events it holds, never stored. */
export function currentTyres(events: TyreEvent[], currentOdometerKm: number | null): WheelStatus[] {
  return WHEELS.map((wheel) => {
    let replaced: TyreEvent | null = null;
    let rotated: TyreEvent | null = null;
    for (const e of events) {
      if (!e.wheels.includes(wheel)) continue;
      if (e.kind === 'replace' && (replaced === null || isLater(e, replaced))) replaced = e;
      if (e.kind === 'rotate' && (rotated === null || isLater(e, rotated))) rotated = e;
    }
    return {
      wheel,
      replaced,
      kmSinceReplace: kmSince(replaced, currentOdometerKm),
      rotated,
      kmSinceRotate: kmSince(rotated, currentOdometerKm),
    };
  });
}
