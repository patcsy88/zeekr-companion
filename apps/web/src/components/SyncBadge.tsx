import type { WarrantySync } from '../data/warrantyOverlay';

export function SyncBadge({ sync }: { sync: WarrantySync }) {
  if (sync === 'synced') return null;
  const text = {
    pending: 'Pending',
    sending: 'Sending',
    failed: 'Failed',
    blocked: 'Blocked',
  }[sync];
  const cls = sync === 'failed' || sync === 'blocked' ? 'bad' : 'info';
  return (
    <span className={`badge ${cls}`} data-testid={`sync-${sync}`}>
      {text}
    </span>
  );
}
