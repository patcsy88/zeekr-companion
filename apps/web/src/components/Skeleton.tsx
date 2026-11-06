/** A placeholder while a page loads. Screen readers still hear "Loading…". */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" className="skeleton" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" aria-hidden="true" />
      ))}
    </div>
  );
}
