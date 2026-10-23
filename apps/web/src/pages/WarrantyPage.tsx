import { Link, useLocation } from 'react-router-dom';
import { BasisNote, CoverageItem } from '../components/WarrantyParts';
import { useConnectivity, useSession, useWarranty } from '../data/hooks';
import type { WarrantyStatusValue } from '../api/types';
import { COMPUTED_OFFLINE, TERMS_LINE } from '../lib/warrantyText';

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

  if (snap === undefined) return <p role="status">Loading…</p>;
  const empty = snap.coverages.length === 0;

  return (
    <section aria-labelledby="war-title">
      <div className="row">
        <h1 id="war-title">Warranty</h1>
        <Link to="/warranty/new" className="button primary">
          Add coverage
        </Link>
      </div>
      {notice ? (
        <p className="notice info" role="status" data-testid="dropped-notice">
          {notice}
        </p>
      ) : null}
      <p className="muted small" data-testid="terms-line">
        {TERMS_LINE}
      </p>
      <p className="muted small" data-testid="status-computed-offline">
        {COMPUTED_OFFLINE}
      </p>
      <BasisNote basis={snap.basis} />
      <p>
        <Link to="/warranty/template">Suggested factory warranty terms</Link>
      </p>

      {!snap.loaded && empty ? (
        <p className="muted">
          {session.signedIn
            ? online
              ? 'Loading warranty entries…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your warranty entries.'}
        </p>
      ) : empty ? (
        <p className="muted">No warranty coverages yet.</p>
      ) : (
        GROUPS.map((g) => {
          const items = snap.coverages.filter((v) => v.coverage.status === g.status);
          if (items.length === 0) return null;
          return (
            <div key={g.status}>
              <h2>{g.title}</h2>
              <ul className="list" aria-label={`${g.title} coverages`}>
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
