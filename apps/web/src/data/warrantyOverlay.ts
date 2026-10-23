import type {
  ClaimEdit,
  CoverageEdit,
  WarrantyClaim,
  WarrantyClaimCreate,
  WarrantyCoverage,
  WarrantyCoverageCreate,
} from '../api/types';
import { warrantyStatus } from '../lib/warrantyStatus';
import { blockedClaimIds } from '../storage/queue';
import type { QueueEntry, QueueError } from '../storage/db';
import type { SyncState } from './overlay';

/** A claim create that waits for a coverage whose create failed is `blocked` (AC-62). */
export type WarrantySync = SyncState | 'blocked';

export interface CoverageView {
  coverage: WarrantyCoverage;
  sync: WarrantySync;
  error: QueueError | null;
}

export interface ClaimView {
  claim: WarrantyClaim;
  sync: WarrantySync;
  error: QueueError | null;
  /** Coverage id whose failed create blocks this claim, else null. */
  blockedBy: string | null;
}

const RANK: Record<SyncState, number> = { synced: 0, pending: 1, sending: 2, failed: 3 };

function worst<T extends { sync: WarrantySync; error: QueueError | null }>(a: T, e: QueueEntry) {
  const s: SyncState = e.status;
  const cur = a.sync === 'blocked' ? 'pending' : a.sync;
  return RANK[s] > RANK[cur] ? { sync: s, error: e.last_error } : { sync: a.sync, error: a.error };
}

const STATUS_RANK = { expiring_soon: 0, active: 1, not_started: 2, expired: 3 } as const;

/** Order: expiring soon, active, not started, expired; then end date (nulls last), name, id. */
export function compareCoverages(a: WarrantyCoverage, b: WarrantyCoverage): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (a.end_date !== b.end_date) {
    if (a.end_date === null) return 1;
    if (b.end_date === null) return -1;
    return a.end_date < b.end_date ? -1 : 1;
  }
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Newest first: date, then created_at, then id, all descending (AC-60). */
export function compareClaims(a: WarrantyClaim, b: WarrantyClaim): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function coverageEdit(c: WarrantyCoverage, p: CoverageEdit): WarrantyCoverage {
  const out = { ...c };
  if (p.name != null) out.name = p.name;
  if (p.provider_type != null) out.provider_type = p.provider_type;
  if (p.start_date != null) out.start_date = p.start_date;
  if (p.end_date !== undefined) out.end_date = p.end_date;
  if (p.km_limit !== undefined) out.km_limit = p.km_limit;
  if (p.notes !== undefined) out.notes = p.notes;
  if (p.verification_status != null) out.verification_status = p.verification_status;
  if (p.source_note !== undefined) out.source_note = p.source_note;
  return out;
}

function claimEdit(c: WarrantyClaim, p: ClaimEdit): WarrantyClaim {
  const out = { ...c };
  if (p.date != null) out.date = p.date;
  if (p.odometer != null) out.odometer = p.odometer;
  if (p.description != null) out.description = p.description;
  if (p.status != null) out.status = p.status;
  if (p.cost_covered_minor !== undefined) out.cost_covered_minor = p.cost_covered_minor;
  if (p.notes !== undefined) out.notes = p.notes;
  return out;
}

export function overlayClaims(
  cached: WarrantyClaim[],
  queue: QueueEntry[],
  coverageIds: Set<string> | null,
): ClaimView[] {
  const blocked = blockedClaimIds(queue);
  const map = new Map<string, ClaimView>();
  for (const c of cached) map.set(c.id, { claim: c, sync: 'synced', error: null, blockedBy: null });
  for (const e of queue) {
    if (e.kind === 'create-claim') {
      const body = e.body as WarrantyClaimCreate;
      const prev = map.get(e.record_id);
      const claim: WarrantyClaim = prev
        ? claimEdit(prev.claim, body)
        : {
            id: body.id,
            coverage_id: body.coverage_id,
            date: body.date,
            odometer: body.odometer,
            description: body.description,
            status: body.status,
            cost_covered_minor: body.cost_covered_minor ?? null,
            currency: body.currency ?? 'MYR',
            notes: body.notes ?? null,
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, {
        ...worst(prev ?? { sync: 'synced', error: null }, e),
        claim,
        blockedBy: null,
      });
    } else if (e.kind === 'edit-claim') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...prev,
        ...worst(prev, e),
        claim: claimEdit(prev.claim, e.body as ClaimEdit),
      });
    } else if (e.kind === 'delete-claim') {
      map.delete(e.record_id);
    }
  }
  const out: ClaimView[] = [];
  for (const v of map.values()) {
    if (coverageIds !== null && !coverageIds.has(v.claim.coverage_id)) continue;
    const by = blocked.get(v.claim.id) ?? null;
    out.push(by ? { ...v, sync: 'blocked', blockedBy: by } : v);
  }
  return out.sort((a, b) => compareClaims(a.claim, b.claim));
}

/**
 * Cached server coverages with the unsent queue on top. Status is always recomputed here from
 * the current odometer and the device date (AC-63); the server value is only a starting point.
 */
export function overlayCoverages(
  cached: WarrantyCoverage[],
  queue: QueueEntry[],
  claims: ClaimView[] | null,
  currentOdometerKm: number | null,
  today: string,
): CoverageView[] {
  const map = new Map<string, CoverageView>();
  for (const c of cached) map.set(c.id, { coverage: c, sync: 'synced', error: null });
  for (const e of queue) {
    if (e.kind === 'create-coverage') {
      const body = e.body as WarrantyCoverageCreate;
      const prev = map.get(e.record_id);
      const coverage: WarrantyCoverage = prev
        ? coverageEdit(prev.coverage, body)
        : {
            id: body.id,
            name: body.name,
            provider_type: body.provider_type,
            start_date: body.start_date,
            end_date: body.end_date ?? null,
            km_limit: body.km_limit ?? null,
            notes: body.notes ?? null,
            source_kind: body.source_kind ?? 'owner_entered',
            verification_status: body.verification_status ?? 'unverified',
            source_note: body.source_note ?? null,
            template_ref: body.template_ref ?? null,
            status: 'active',
            expired_by: [],
            expiring_soon_by: [],
            claim_count: 0,
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, { ...worst(prev ?? { sync: 'synced', error: null }, e), coverage });
    } else if (e.kind === 'edit-coverage') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...worst(prev, e),
        coverage: coverageEdit(prev.coverage, e.body as CoverageEdit),
      });
    } else if (e.kind === 'delete-coverage') {
      map.delete(e.record_id);
    }
  }
  const pendingCreates = new Map<string, number>();
  for (const e of queue) {
    if (e.kind !== 'create-claim') continue;
    const cov = (e.body as WarrantyClaimCreate).coverage_id;
    pendingCreates.set(cov, (pendingCreates.get(cov) ?? 0) + 1);
  }
  const views = [...map.values()].map((v) => {
    const claim_count = claims
      ? claims.filter((c) => c.claim.coverage_id === v.coverage.id).length
      : v.coverage.claim_count + (pendingCreates.get(v.coverage.id) ?? 0);
    return {
      ...v,
      coverage: {
        ...v.coverage,
        ...warrantyStatus(v.coverage, currentOdometerKm, today),
        claim_count,
      },
    };
  });
  return views.sort((a, b) => compareCoverages(a.coverage, b.coverage));
}
