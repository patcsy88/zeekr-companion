import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ClaimForm, type ClaimFormValues } from '../components/ClaimForm';
import { CoverageForm, type CoverageFormValues } from '../components/CoverageForm';
import { useWarranty } from '../data/hooks';
import { saveClaimEdit, saveCoverageEdit, saveNewClaim, saveNewCoverage } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

export function NewCoveragePage() {
  const nav = useNavigate();
  const id = useMemo(() => uuid(), []);
  async function submit(v: CoverageFormValues) {
    await saveNewCoverage({ id, ...v, source_kind: 'owner_entered' });
    void nav('/warranty');
  }
  return (
    <section aria-labelledby="new-cov-title">
      <h1 id="new-cov-title">Add coverage</h1>
      <CoverageForm submitLabel="Save" onSubmit={submit} onCancel={() => void nav('/warranty')} />
    </section>
  );
}

export function EditCoveragePage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <EditCoverage id={id} />;
}

function EditCoverage({ id }: { id: string }) {
  const nav = useNavigate();
  const snap = useWarranty();
  if (snap === undefined) return <p role="status">Loading…</p>;
  const view = snap.coverages.find((v) => v.coverage.id === id);
  if (!view) return <p>Coverage not found.</p>;
  async function submit(v: CoverageFormValues) {
    await saveCoverageEdit(id, v);
    void nav(`/warranty/${id}`);
  }
  return (
    <section aria-labelledby="edit-cov-title">
      <h1 id="edit-cov-title">Edit coverage</h1>
      <CoverageForm
        initial={view.coverage}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(`/warranty/${id}`)}
        serverIssues={view.error ? issuesByField(view.error.details) : undefined}
      />
    </section>
  );
}

export function NewClaimPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <NewClaim coverageId={id} />;
}

function NewClaim({ coverageId }: { coverageId: string }) {
  const nav = useNavigate();
  const claimId = useMemo(() => uuid(), []);
  const snap = useWarranty();
  if (snap === undefined) return <p role="status">Loading…</p>;
  const view = snap.coverages.find((v) => v.coverage.id === coverageId);
  if (!view) return <p>Coverage not found.</p>;
  async function submit(v: ClaimFormValues) {
    await saveNewClaim({ id: claimId, coverage_id: coverageId, ...v });
    void nav(`/warranty/${coverageId}`);
  }
  return (
    <section aria-labelledby="new-claim-title">
      <h1 id="new-claim-title">Add claim</h1>
      <p className="muted">For: {view.coverage.name}</p>
      <ClaimForm
        coverage={view.coverage}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => void nav(`/warranty/${coverageId}`)}
      />
    </section>
  );
}

export function EditClaimPage() {
  const { claimId } = useParams();
  if (!isUuid(claimId)) return <p>Page not found.</p>;
  return <EditClaim id={claimId} />;
}

function EditClaim({ id }: { id: string }) {
  const nav = useNavigate();
  const snap = useWarranty();
  if (snap === undefined) return <p role="status">Loading…</p>;
  const cv = snap.claims.find((c) => c.claim.id === id);
  const cov = cv ? snap.coverages.find((v) => v.coverage.id === cv.claim.coverage_id) : undefined;
  if (!cv || !cov) return <p>Claim not found.</p>;
  const back = `/warranty/${cov.coverage.id}`;
  async function submit(v: ClaimFormValues) {
    await saveClaimEdit(id, v);
    void nav(back);
  }
  return (
    <section aria-labelledby="edit-claim-title">
      <h1 id="edit-claim-title">Edit claim</h1>
      <ClaimForm
        coverage={cov.coverage}
        initial={cv.claim}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(back)}
        serverIssues={cv.error ? issuesByField(cv.error.details) : undefined}
      />
    </section>
  );
}
