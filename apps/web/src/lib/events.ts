/** Tiny pub/sub used to tell the UI that local data (cache or queue) changed. */
type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Bumped on every local data change. A network refresh remembers the value from before its
 * request and discards its response if the value moved: the response may predate a local write
 * (for example a delete) and would otherwise undo it. See data/repository.ts.
 */
let epoch = 0;

export function dataEpoch(): number {
  return epoch;
}

export function bumpEpoch(): void {
  epoch += 1;
}

export function subscribeData(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function notifyData(): void {
  bumpEpoch();
  for (const l of [...listeners]) l();
}
