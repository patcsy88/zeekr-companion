/** A placeholder while a page loads. Screen readers still hear "Loading…". */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" className="grid gap-3 py-2" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        // The shimmer is in app.css; the class name is also what the tests count.
        <span key={i} className="skeleton-line" aria-hidden="true" />
      ))}
    </div>
  );
}
