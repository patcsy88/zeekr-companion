import { Link, useLocation } from 'react-router-dom';
import { BasisNote, CoverageItem } from '../components/WarrantyParts';
import { useConnectivity, useSession, useWarranty } from '../data/hooks';
import type { WarrantyStatusValue } from '../api/types';
import { COMPUTED_OFFLINE, TERMS_LINE } from '../lib/warrantyText';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, HEAD, LIST, MUTED, NOTICE, SMALL } from '../components/ListParts';
import { Button } from '../components/ui/button';

const GROUPS: { status: WarrantyStatusValue; title: string }[] = [
  { status: 'expiring_soon', title: 'Expiring soon' },
  { status: 'active', title: 'Active by the dates and km you entered' },
  { status: 'not_started', title: 'Not started' },
  { status: 'expired', title: 'Expired' },
];

export function WarrantyPage() {
  const snap = useWarranty();
  const { online } = useConnectivity();
  const session = useSession();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (snap === undefined) return <Skeleton />;
  const empty = snap.coverages.length === 0;

  return (
    <section aria-labelledby="war-title">
      <div className={HEAD}>
        <h1 id="war-title">Warranty</h1>
        <Button size="lg" render={<Link to="/warranty/new" />}>
          Add coverage
        </Button>
      </div>
      {notice ? (
        <p className={NOTICE.info} role="status" data-testid="dropped-notice">
          {notice}
        </p>
      ) : null}
      <p className={SMALL} data-testid="terms-line">
        {TERMS_LINE}
      </p>
      <p className={SMALL} data-testid="status-computed-offline">
        {COMPUTED_OFFLINE}
      </p>
      <BasisNote basis={snap.basis} />
      <p>
        <Link to="/warranty/template">Suggested factory warranty terms</Link>
      </p>

      {!snap.loaded && empty ? (
        <p className={MUTED}>
          {session.signedIn
            ? online
              ? 'Loading warranty entries…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your warranty entries.'}
        </p>
      ) : empty ? (
        <EmptyState
          title="No warranty coverages yet."
          hint="Use Add coverage at the top to record the first one."
        />
      ) : (
        GROUPS.map((g) => {
          const items = snap.coverages.filter((v) => v.coverage.status === g.status);
          if (items.length === 0) return null;
          return (
            <div key={g.status}>
              <h2>{g.title}</h2>
              <ul className={LIST} aria-label={`${g.title} coverages`}>
                {items.map((v) => (
                  <CoverageItem key={v.coverage.id} view={v} basis={snap.basis} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
