import { Link } from 'react-router-dom';
import type { WarrantyCoverage } from '../api/types';
import type { OdometerBasis } from '../data/reminders';
import type { CoverageView } from '../data/warrantyOverlay';
import { formatDate } from '../lib/dates';
import {
  SOURCE_KIND_LABELS,
  statusLabel,
  TYPE_LABELS,
  VERIFICATION_LABELS,
} from '../lib/warrantyText';
import { ITEM_BODY, ItemCard, META, SMALL, TITLE } from './ListParts';
import { SyncBadge } from './SyncBadge';
import { Badge } from './ui/badge';

export function BasisNote({ basis }: { basis: OdometerBasis | null }) {
  if (basis === null)
    return (
      <p className={SMALL} data-testid="odometer-basis">
        Current odometer: unknown. Add a service record to set it.
      </p>
    );
  return (
    <p className={SMALL} data-testid="odometer-basis">
      Current odometer: {basis.km.toLocaleString()} km
      {basis.date ? `, from the service record dated ${formatDate(basis.date)}` : ''}
      {basis.unsent ? ' (saved on this device, not yet on the server)' : ''}.
    </p>
  );
}

export function StatusBadge({
  coverage,
  wrap = false,
}: {
  coverage: Pick<WarrantyCoverage, 'status' | 'expired_by'>;
  /** Let a long label break onto more lines instead of widening the badge (the list card). */
  wrap?: boolean;
}) {
  const variant = (
    { active: 'success', expiring_soon: 'warning', not_started: 'info', expired: 'error' } as const
  )[coverage.status];
  return (
    <Badge
      variant={variant}
      size="lg"
      data-testid="warranty-status"
      className={
        wrap ? 'h-auto min-h-6.5 whitespace-normal py-0.5 text-start sm:h-auto' : undefined
      }
    >
      {statusLabel(coverage)}
    </Badge>
  );
}

/** Basis shown next to any coverage with a km limit. */
export function KmBasis({
  coverage,
  basis,
}: {
  coverage: Pick<WarrantyCoverage, 'km_limit'>;
  basis: OdometerBasis | null;
}) {
  if (coverage.km_limit === null) return null;
  return (
    <span className={META} data-testid="km-basis">
      {basis
        ? `Km limit ${coverage.km_limit.toLocaleString()} km, compared with current odometer ${basis.km.toLocaleString()} km`
        : `Km limit ${coverage.km_limit.toLocaleString()} km, odometer unknown`}
    </span>
  );
}

export function datesText(c: Pick<WarrantyCoverage, 'start_date' | 'end_date'>): string {
  return `${formatDate(c.start_date)} to ${c.end_date ? formatDate(c.end_date) : 'no end date'}`;
}

export function SourceLines({ coverage }: { coverage: WarrantyCoverage }) {
  return (
    <>
      <span className={META}>
        {TYPE_LABELS[coverage.provider_type]} · {SOURCE_KIND_LABELS[coverage.source_kind]} ·{' '}
        {VERIFICATION_LABELS[coverage.verification_status]}
      </span>
      {coverage.source_note ? <span className={META}>Source: {coverage.source_note}</span> : null}
    </>
  );
}

export function CoverageItem({ view, basis }: { view: CoverageView; basis: OdometerBasis | null }) {
  const c = view.coverage;
  return (
    <ItemCard className="flex-col items-stretch gap-0 pe-0">
      <Link to={`/warranty/${c.id}`} className={ITEM_BODY}>
        <span className={TITLE}>{c.name}</span>
        <span className={META}>{datesText(c)}</span>
        <KmBasis coverage={c} basis={basis} />
        <SourceLines coverage={c} />
        <span className={META}>
          {c.claim_count} {c.claim_count === 1 ? 'claim' : 'claims'}
        </span>
      </Link>
      <div className="flex flex-wrap items-start gap-2 px-3 pb-3" data-testid="coverage-badges">
        <StatusBadge coverage={c} wrap />
        <SyncBadge sync={view.sync} />
      </div>
    </ItemCard>
  );
}
