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
    <li className="item">
      <div>
        <span className="title prewrap">{c.description}</span>
        <span className="meta">
          {formatDate(c.date)} · {c.odometer.toLocaleString()} km · {CLAIM_STATUS_LABELS[c.status]}
        </span>
        {c.cost_covered_minor !== null ? (
          <span className="meta">
            Cost covered (record only): {formatMyr(c.cost_covered_minor)}
          </span>
        ) : null}
        {c.notes ? <span className="meta prewrap">{c.notes}</span> : null}
        {v.sync === 'blocked' ? (
          <p className="notice bad" role="alert" data-testid="claim-blocked">
            Blocked: this claim is waiting for the coverage &quot;{coverageName}&quot;, which the
            server did not accept. It has not been sent. Retry or discard the coverage above.
          </p>
        ) : null}
        {v.sync === 'failed' && v.error ? <FailedNotice error={v.error} /> : null}
        {confirming ? (
          <div role="alertdialog" aria-label="Delete claim" className="notice bad">
            <p>Delete this claim? This cannot be undone.</p>
            <div className="actions">
              <button
                type="button"
                className="danger"
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
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <Link to={`/warranty/claims/${c.id}/edit`} className="button">
              Edit claim
            </Link>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete claim
            </button>
          </div>
        )}
      </div>
      <SyncBadge sync={v.sync} />
    </li>
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

  if (snap === undefined) return <p role="status">Loading…</p>;
  const view = snap.coverages.find((v) => v.coverage.id === id);
  if (!view) {
    return (
      <section>
        <h1>Coverage not found</h1>
        <p className="muted">It may have been deleted, or it is not saved on this device.</p>
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
      <div className="row">
        <h1 id="cov-title" className="prewrap">
          {c.name}
        </h1>
        <StatusBadge coverage={c} />
        <SyncBadge sync={sync} />
      </div>
      {sync === 'pending' || sync === 'sending' ? (
        <p className="notice info">
          This change is saved on this device and has not reached the server yet.
        </p>
      ) : null}
      {sync === 'failed' && error ? (
        <>
          <FailedNotice error={error} />
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void retryFailed(id).then(() => syncAll(true));
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                void discardFailedCoverage(id);
              }}
            >
              Discard my change
            </button>
          </div>
        </>
      ) : null}
      <p className="muted small" data-testid="status-computed-offline">
        Status is computed on this device and may differ from the server until the next sync.
      </p>
      <dl className="details">
        <dt>Dates</dt>
        <dd>{datesText(c)}</dd>
        <dt>Km limit</dt>
        <dd>
          {c.km_limit === null ? '—' : `${c.km_limit.toLocaleString()} km`}
          <KmBasis coverage={c} basis={snap.basis} />
          {c.km_limit !== null && snap.basis === null ? (
            <span className="meta">Odometer unknown</span>
          ) : null}
        </dd>
        <dt>Source</dt>
        <dd>
          <SourceLines coverage={c} />
        </dd>
        <dt>Notes</dt>
        <dd className="prewrap">{c.notes ?? '—'}</dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={c.updated_at}>{formatTimestamp(c.updated_at)}</time>
        </dd>
      </dl>
      <p className="muted small" data-testid="terms-fixed">
        {TERMS_LINE}
      </p>

      <h2>Claims ({claims.length})</h2>
      {claims.length === 0 ? (
        <p className="muted">No claims recorded.</p>
      ) : (
        <ul className="list" aria-label="Claims, newest first">
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
          className="notice bad"
        >
          <h2 id="del-cov-title">Delete this coverage?</h2>
          <p id="del-cov-desc" data-testid="delete-claim-count">
            This also deletes {c.claim_count} {c.claim_count === 1 ? 'claim' : 'claims'}. This
            cannot be undone.
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              Delete coverage
            </button>
            <button
              type="button"
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <Link to={`/warranty/${id}/claims/new`} className="button primary">
            Add claim
          </Link>
          <Link to={`/warranty/${id}/edit`} className="button">
            Edit
          </Link>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Delete
          </button>
          <Link to="/warranty">Back</Link>
        </div>
      )}
    </article>
  );
}
