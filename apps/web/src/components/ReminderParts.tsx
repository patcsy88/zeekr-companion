import { Link } from 'react-router-dom';
import type { OdometerBasis } from '../data/reminders';
import type { ReminderView } from '../data/reminderOverlay';
import { formatDate } from '../lib/dates';
import { isDueSoon } from '../lib/reminderStatus';
import { dateText, KIND_CONTEXT, KIND_LABELS, kmText } from '../lib/reminderText';
import { SyncBadge } from './SyncBadge';

export function BasisNote({ basis }: { basis: OdometerBasis | null }) {
  if (basis === null)
    return (
      <p className="muted small" data-testid="odometer-basis">
        Current odometer: unknown. Add a service record to set it.
      </p>
    );
  return (
    <p className="muted small" data-testid="odometer-basis">
      Current odometer: {basis.km.toLocaleString()} km
      {basis.date ? `, from the service record dated ${formatDate(basis.date)}` : ''}
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
  if (r.status === 'completed') return <span className="badge ok">Completed</span>;
  if (r.status === 'overdue') {
    const by = r.overdue_by.map((b) => (b === 'date' ? 'date' : 'km')).join(' and ');
    return <span className="badge bad">Overdue ({by})</span>;
  }
  return isDueSoon(r, basis?.km ?? null, today) ? (
    <span className="badge warn">Due soon</span>
  ) : (
    <span className="badge info">Upcoming</span>
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
    <li className="item">
      <Link to={`/reminders/${r.id}`}>
        <span className="title">{r.title}</span>
        <span className="meta">
          {KIND_LABELS[r.kind]}
          {KIND_CONTEXT[r.kind] ? ` · ${KIND_CONTEXT[r.kind] ?? ''}` : ''}
        </span>
        {when ? <span className="meta">{when}</span> : null}
        {km ? <span className="meta">{km}</span> : null}
        {r.due_odometer !== null && r.completed_on === null ? (
          <span className="meta">
            {basis
              ? `Based on current odometer ${basis.km.toLocaleString()} km`
              : 'Current odometer unknown'}
          </span>
        ) : null}
      </Link>
      <StatusBadge view={view} basis={basis} today={today} />
      <SyncBadge sync={view.sync} />
    </li>
  );
}
