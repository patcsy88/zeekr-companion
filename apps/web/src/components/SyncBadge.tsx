import type { SyncState } from '../data/overlay';

export function SyncBadge({ sync }: { sync: SyncState }) {
  if (sync === 'synced') return null;
  const text = { pending: 'Pending', sending: 'Sending', failed: 'Failed' }[sync];
  const cls = sync === 'failed' ? 'bad' : 'info';
  return (
    <span className={`badge ${cls}`} data-testid={`sync-${sync}`}>
      {text}
    </span>
  );
}
