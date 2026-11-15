import type { WarrantySync } from '../data/warrantyOverlay';
import { Badge } from './ui/badge';

export function SyncBadge({ sync }: { sync: WarrantySync }) {
  if (sync === 'synced') return null;
  const text = {
    pending: 'Pending',
    sending: 'Sending',
    failed: 'Failed',
    blocked: 'Blocked',
  }[sync];
  const variant = sync === 'failed' || sync === 'blocked' ? 'error' : 'info';
  return (
    <Badge variant={variant} size="lg" data-testid={`sync-${sync}`}>
      {text}
    </Badge>
  );
}
