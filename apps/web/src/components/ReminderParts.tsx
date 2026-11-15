import { Link } from 'react-router-dom';
import type { OdometerBasis } from '../data/reminders';
import type { ReminderView } from '../data/reminderOverlay';
import { formatDate } from '../lib/dates';
import { isDueSoon } from '../lib/reminderStatus';
import { dateText, KIND_CONTEXT, KIND_LABELS, kmText } from '../lib/reminderText';
import { ITEM_BODY, ItemCard, META, SMALL, TITLE } from './ListParts';
import { SyncBadge } from './SyncBadge';
import { Badge } from './ui/badge';

export function BasisNote({ basis }: { basis: OdometerBasis | null }) {
  if (basis === null)
    return (
      <p className={SMALL} data-testid="odometer-basis">
        Current odometer: unknown. Add a service record to set it.
      </p>
    );
  return (
    <p className={SMALL} data-testid="odometer-basis">
      Current odometer: {basis.km.toLocaleString()} km
      {basis.live
        ? basis.date
          ? `, from the car's reading on ${formatDate(basis.date)}`
          : ''
        : basis.date
          ? `, from the service record dated ${formatDate(basis.date)}`
          : ''}
      {basis.unsent ? ' (saved on this device, not yet on the server)' : ''}.
    </p>
  );
}

export function StatusBadge({
  view,
  basis,
  today,
}: {
  view: ReminderView;
  basis: OdometerBasis | null;
  today: string;
}) {
  const r = view.reminder;
  if (r.status === 'completed')
    return (
      <Badge variant="success" size="lg">
        Completed
      </Badge>
    );
  if (r.status === 'overdue') {
    const by = r.overdue_by.map((b) => (b === 'date' ? 'date' : 'km')).join(' and ');
    return (
      <Badge variant="error" size="lg">
        Overdue ({by})
      </Badge>
    );
  }
  return isDueSoon(r, basis?.km ?? null, today) ? (
    <Badge variant="warning" size="lg">
      Due soon
    </Badge>
  ) : (
    <Badge variant="info" size="lg">
      Upcoming
    </Badge>
  );
}

export function ReminderItem({
  view,
  basis,
  today,
}: {
  view: ReminderView;
  basis: OdometerBasis | null;
  today: string;
}) {
  const r = view.reminder;
  const when = dateText(r, today);
  const km = kmText(r, basis?.km ?? null);
  return (
    <ItemCard>
      <Link to={`/reminders/${r.id}`} className={ITEM_BODY}>
        <span className={TITLE}>{r.title}</span>
        <span className={META}>
          {KIND_LABELS[r.kind]}
          {KIND_CONTEXT[r.kind] ? ` · ${KIND_CONTEXT[r.kind] ?? ''}` : ''}
        </span>
        {when ? <span className={META}>{when}</span> : null}
        {km ? <span className={META}>{km}</span> : null}
        {r.due_odometer !== null && r.completed_on === null ? (
          <span className={META}>
            {basis
              ? `Based on current odometer ${basis.km.toLocaleString()} km`
              : 'Current odometer unknown'}
          </span>
        ) : null}
      </Link>
      <StatusBadge view={view} basis={basis} today={today} />
      <SyncBadge sync={view.sync} />
    </ItemCard>
  );
}
