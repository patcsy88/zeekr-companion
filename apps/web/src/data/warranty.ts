import { getWarrantyTemplates, listClaims, listCoverages } from '../api/endpoints';
import type {
  CurrentOdometer,
  WarrantyClaim,
  WarrantyCoverage,
  WarrantyTemplate,
} from '../api/types';
import { bumpEpoch, notifyData } from '../lib/events';
import { klToday } from '../lib/dates';
import { getCache, setCache } from '../storage/cache';
import { listQueue } from '../storage/queue';
import type { OdometerBasis } from './reminders';
import {
  compareClaims,
  overlayClaims,
  overlayCoverages,
  type ClaimView,
  type CoverageView,
} from './warrantyOverlay';
import { markSynced, readRecords, refreshGuarded, withCacheLock } from './repository';

const COVERAGES_KEY = 'warranty-coverages';
const CLAIMS_KEY = 'warranty-claims';
const TEMPLATES_KEY = 'warranty-templates';

interface CoverageCache {
  items: WarrantyCoverage[];
  current_odometer: CurrentOdometer | null;
}
interface ClaimCache {
  items: WarrantyClaim[];
}

export interface WarrantySnapshot {
  /** False until the coverage list has been fetched at least once on this device. */
  loaded: boolean;
  claimsLoaded: boolean;
  coverages: CoverageView[];
  claims: ClaimView[];
  basis: OdometerBasis | null;
  today: string;
  fetchedAt: string | null;
}

/** Same rule as reminders: newest service record (cache plus unsent), else the server's value. */
async function deriveBasis(cached: CoverageCache | undefined): Promise<OdometerBasis | null> {
  const records = await readRecords();
  const newest = records.views[0];
  if (newest)
    return {
      km: newest.record.odometer,
      date: newest.record.date,
      unsent: newest.sync !== 'synced',
    };
  if (records.loaded) return null;
  const co = cached?.current_odometer;
  return co ? { km: co.km, date: co.date, unsent: false } : null;
}

export async function readWarranty(): Promise<WarrantySnapshot> {
  const [cov, cl, queue] = await Promise.all([
    getCache<CoverageCache>(COVERAGES_KEY),
    getCache<ClaimCache>(CLAIMS_KEY),
    listQueue(),
  ]);
  const basis = await deriveBasis(cov?.value);
  const today = klToday();
  // Overlay once without the coverage filter to learn the ids, then filter orphans of deletes.
  const draft = overlayCoverages(cov?.value.items ?? [], queue, null, basis?.km ?? null, today);
  const ids = new Set(draft.map((v) => v.coverage.id));
  const claims = overlayClaims(cl?.value.items ?? [], queue, cov ? ids : null);
  const coverages = overlayCoverages(
    cov?.value.items ?? [],
    queue,
    cl ? claims : null,
    basis?.km ?? null,
    today,
  );
  return {
    loaded: cov !== undefined,
    claimsLoaded: cl !== undefined,
    coverages,
    claims,
    basis,
    today,
    fetchedAt: cov?.fetched_at ?? null,
  };
}

export async function refreshWarranty(): Promise<void> {
  await refreshGuarded(
    async () => {
      const covs = await listCoverages();
      const claims = await listClaims();
      return { covs, claims };
    },
    async ({ covs, claims }) => {
      await setCache(COVERAGES_KEY, {
        items: covs.items,
        current_odometer: covs.current_odometer ?? null,
      } satisfies CoverageCache);
      await setCache(CLAIMS_KEY, { items: claims.items } satisfies ClaimCache);
    },
  );
  await markSynced();
  notifyData();
}

export async function readWarrantyTemplates(): Promise<{
  loaded: boolean;
  items: WarrantyTemplate[];
}> {
  const cached = await getCache<{ items: WarrantyTemplate[] }>(TEMPLATES_KEY);
  return { loaded: cached !== undefined, items: cached?.value.items ?? [] };
}

/** The template is static server data: fetched when online, then cached (AC-61). */
export async function refreshWarrantyTemplates(): Promise<void> {
  const list = await getWarrantyTemplates();
  await withCacheLock(async () => {
    await setCache(TEMPLATES_KEY, { items: list.items });
    bumpEpoch();
  });
  notifyData();
}

/** Without a cached list there is nothing to update; the next refresh fills it. */
export function upsertCoverageInCache(coverage: WarrantyCoverage): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<CoverageCache>(COVERAGES_KEY);
    if (cached) {
      const items = cached.value.items.filter((x) => x.id !== coverage.id);
      items.push(coverage);
      await setCache(COVERAGES_KEY, {
        items,
        current_odometer: cached.value.current_odometer,
      } satisfies CoverageCache);
    }
    bumpEpoch();
  });
}

export function removeCoverageFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<CoverageCache>(COVERAGES_KEY);
    if (cached) {
      await setCache(COVERAGES_KEY, {
        items: cached.value.items.filter((x) => x.id !== id),
        current_odometer: cached.value.current_odometer,
      } satisfies CoverageCache);
    }
    const claims = await getCache<ClaimCache>(CLAIMS_KEY);
    if (claims) {
      await setCache(CLAIMS_KEY, {
        items: claims.value.items.filter((x) => x.coverage_id !== id),
      } satisfies ClaimCache);
    }
    bumpEpoch();
  });
}

export function upsertClaimInCache(claim: WarrantyClaim): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<ClaimCache>(CLAIMS_KEY);
    if (cached) {
      const items = cached.value.items.filter((x) => x.id !== claim.id);
      items.push(claim);
      items.sort(compareClaims);
      await setCache(CLAIMS_KEY, { items } satisfies ClaimCache);
    }
    bumpEpoch();
  });
}

export function removeClaimFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<ClaimCache>(CLAIMS_KEY);
    if (cached) {
      await setCache(CLAIMS_KEY, {
        items: cached.value.items.filter((x) => x.id !== id),
      } satisfies ClaimCache);
    }
    bumpEpoch();
  });
}
