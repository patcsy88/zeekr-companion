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
import { SyncBadge } from './SyncBadge';

export function BasisNote({ basis }: { basis: OdometerBasis | null }) {
  if (basis === null)
    return (
      <p className="muted small" data-testid="odometer-basis">
        Current odometer: unknown. Add a service record to set it.
      </p>
    );
  return (
    <p className="muted small" data-testid="odometer-basis">
      Current odometer: {basis.km.toLocaleString()} km
      {basis.date ? `, from the service record dated ${formatDate(basis.date)}` : ''}
      {basis.unsent ? ' (saved on this device, not yet on the server)' : ''}.
    </p>
  );
}

export function StatusBadge({
  coverage,
}: {
  coverage: Pick<WarrantyCoverage, 'status' | 'expired_by'>;
}) {
  const cls = { active: 'ok', expiring_soon: 'warn', not_started: 'info', expired: 'bad' }[
    coverage.status
  ];
  return (
    <span className={`badge ${cls}`} data-testid="warranty-status">
      {statusLabel(coverage)}
    </span>
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
    <span className="meta" data-testid="km-basis">
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
      <span className="meta">
        {TYPE_LABELS[coverage.provider_type]} · {SOURCE_KIND_LABELS[coverage.source_kind]} ·{' '}
        {VERIFICATION_LABELS[coverage.verification_status]}
      </span>
      {coverage.source_note ? <span className="meta">Source: {coverage.source_note}</span> : null}
    </>
  );
}

export function CoverageItem({ view, basis }: { view: CoverageView; basis: OdometerBasis | null }) {
  const c = view.coverage;
  return (
    <li className="item">
      <Link to={`/warranty/${c.id}`}>
        <span className="title">{c.name}</span>
        <span className="meta">{datesText(c)}</span>
        <KmBasis coverage={c} basis={basis} />
        <SourceLines coverage={c} />
        <span className="meta">
          {c.claim_count} {c.claim_count === 1 ? 'claim' : 'claims'}
        </span>
      </Link>
      <StatusBadge coverage={c} />
      <SyncBadge sync={view.sync} />
    </li>
  );
}
