import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FailedNotice } from '../components/ErrorBox';
import { SyncBadge } from '../components/SyncBadge';
import { KmBasis, SourceLines, StatusBadge, datesText } from '../components/WarrantyParts';
import { useWarranty } from '../data/hooks';
import { removeClaim, removeCoverage } from '../data/mutations';
import type { ClaimView } from '../data/warrantyOverlay';
import { formatDate, formatTimestamp } from '../lib/dates';
import { formatMyr } from '../lib/money';
import { isUuid } from '../lib/uuid';
import { CLAIM_STATUS_LABELS, TERMS_LINE } from '../lib/warrantyText';
import { discardFailedCoverage, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';
import { Skeleton } from '../components/Skeleton';
import {
  Details,
  HEAD,
  ItemCard,
  LIST,
  META,
  MUTED,
  NOTICE,
  PREWRAP,
  ROW_ACTIONS,
  SMALL,
  TITLE,
} from '../components/ListParts';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';

export function CoverageDetailPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <CoverageDetail id={id} />;
}

function ClaimRow({ v, coverageName }: { v: ClaimView; coverageName: string }) {
  const c = v.claim;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <ItemCard className="items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
        <span className={cn(TITLE, PREWRAP)}>{c.description}</span>
        <span className={META}>
          {formatDate(c.date)} · {c.odometer.toLocaleString()} km · {CLAIM_STATUS_LABELS[c.status]}
        </span>
        {c.cost_covered_minor !== null ? (
          <span className={META}>
            Cost covered (record only): {formatMyr(c.cost_covered_minor)}
          </span>
        ) : null}
        {c.notes ? <span className={cn(META, PREWRAP)}>{c.notes}</span> : null}
        {v.sync === 'blocked' ? (
          <p className={NOTICE.bad} role="alert" data-testid="claim-blocked">
            Blocked: this claim is waiting for the coverage &quot;{coverageName}&quot;, which the
            server did not accept. It has not been sent. Retry or discard the coverage above.
          </p>
        ) : null}
        {v.sync === 'failed' && v.error ? <FailedNotice error={v.error} /> : null}
        {confirming ? (
          <div role="alertdialog" aria-label="Delete claim" className={NOTICE.bad}>
            <p>Delete this claim? This cannot be undone.</p>
            <div className={ROW_ACTIONS}>
              <Button
                variant="destructive"
                size="lg"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void removeClaim(c.id).finally(() => {
                    setBusy(false);
                    setConfirming(false);
                  });
                }}
              >
                Delete claim
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={ROW_ACTIONS}>
            <Button
              variant="outline"
              size="lg"
              render={<Link to={`/warranty/claims/${c.id}/edit`} />}
            >
              Edit claim
            </Button>
            <Button
              variant="destructive"
              size="lg"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete claim
            </Button>
          </div>
        )}
      </div>
      <SyncBadge sync={v.sync} />
    </ItemCard>
  );
}

function CoverageDetail({ id }: { id: string }) {
  const nav = useNavigate();
  const snap = useWarranty();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (snap === undefined) return <Skeleton />;
  const view = snap.coverages.find((v) => v.coverage.id === id);
  if (!view) {
    return (
      <section>
        <h1>Coverage not found</h1>
        <p className={MUTED}>It may have been deleted, or it is not saved on this device.</p>
        <Link to="/warranty">Back to warranty</Link>
      </section>
    );
  }
  const { coverage: c, sync, error } = view;
  const claims = snap.claims.filter((v) => v.claim.coverage_id === id);

  async function confirmDelete() {
    setBusy(true);
    try {
      const { droppedClaimCreates } = await removeCoverage(
        id,
        claims.map((v) => v.claim.id),
      );
      const notice =
        droppedClaimCreates > 0
          ? `Coverage deleted. ${droppedClaimCreates} ${droppedClaimCreates === 1 ? 'claim' : 'claims'} saved only on this device for it ${droppedClaimCreates === 1 ? 'was' : 'were'} dropped and will not be sent.`
          : undefined;
      void nav('/warranty', { replace: true, state: notice ? { notice } : null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-labelledby="cov-title">
      <div className={HEAD}>
        <h1 id="cov-title" className={PREWRAP}>
          {c.name}
        </h1>
        <StatusBadge coverage={c} />
        <SyncBadge sync={sync} />
      </div>
      {sync === 'pending' || sync === 'sending' ? (
        <p className={NOTICE.info}>
          This change is saved on this device and has not reached the server yet.
        </p>
      ) : null}
      {sync === 'failed' && error ? (
        <>
          <FailedNotice error={error} />
          <div className={ROW_ACTIONS}>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                void retryFailed(id).then(() => syncAll(true));
              }}
            >
              Retry
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                void discardFailedCoverage(id).then(({ droppedClaimCreates: n }) => {
                  if (n === 0) return;
                  const notice = `Change discarded. ${n} ${n === 1 ? 'claim' : 'claims'} saved only on this device for this coverage ${n === 1 ? 'was' : 'were'} dropped and will not be sent.`;
                  void nav('/warranty', { replace: true, state: { notice } });
                });
              }}
            >
              Discard my change
            </Button>
          </div>
        </>
      ) : null}
      <p className={SMALL} data-testid="status-computed-offline">
        Status is computed on this device and may differ from the server until the next sync.
      </p>
      <Details>
        <dt>Dates</dt>
        <dd>{datesText(c)}</dd>
        <dt>Km limit</dt>
        <dd>
          {c.km_limit === null ? '—' : `${c.km_limit.toLocaleString()} km`}
          <KmBasis coverage={c} basis={snap.basis} />
          {c.km_limit !== null && snap.basis === null ? (
            <span className={META}>Odometer unknown</span>
          ) : null}
        </dd>
        <dt>Source</dt>
        <dd>
          <SourceLines coverage={c} />
        </dd>
        <dt>Notes</dt>
        <dd className={PREWRAP}>{c.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={c.updated_at}>{formatTimestamp(c.updated_at)}</time>
        </dd>
      </Details>
      <p className={SMALL} data-testid="terms-fixed">
        {TERMS_LINE}
      </p>

      <h2>Claims ({claims.length})</h2>
      {claims.length === 0 ? (
        <p className={MUTED}>No claims recorded.</p>
      ) : (
        <ul className={LIST} aria-label="Claims, newest first">
          {claims.map((v) => (
            <ClaimRow key={v.claim.id} v={v} coverageName={c.name} />
          ))}
        </ul>
      )}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="del-cov-title"
          aria-describedby="del-cov-desc"
          className={NOTICE.bad}
        >
          <h2 id="del-cov-title">Delete this coverage?</h2>
          <p id="del-cov-desc" data-testid="delete-claim-count">
            This also deletes {c.claim_count} {c.claim_count === 1 ? 'claim' : 'claims'}. This
            cannot be undone.
          </p>
          <div className={ROW_ACTIONS}>
            <Button
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              Delete coverage
            </Button>
            <Button
              variant="outline"
              size="lg"
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className={ROW_ACTIONS}>
          <Button size="lg" render={<Link to={`/warranty/${id}/claims/new`} />}>
            Add claim
          </Button>
          <Button variant="outline" size="lg" render={<Link to={`/warranty/${id}/edit`} />}>
            Edit
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete
          </Button>
          <Link to="/warranty">Back</Link>
        </div>
      )}
    </article>
  );
}
