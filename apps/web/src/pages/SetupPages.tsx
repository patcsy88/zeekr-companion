import { Link } from 'react-router-dom';
import { PushCard } from '../components/PushCard';
import { EmptyState, HEAD, LIST, MUTED, SMALL } from '../components/ListParts';
import { ReminderItem } from '../components/ReminderParts';
import { Skeleton } from '../components/Skeleton';
import { Button } from '../components/ui/button';
import { useReminders } from '../data/hooks';
import { VehicleProfile } from './VehiclePage';

export function SetupPage() {
  return (
    <section aria-labelledby="setup-title">
      <h1 id="setup-title">Setup</h1>
      <VehicleProfile />
    </section>
  );
}

/** Road tax and insurance reminders with their renewal details. Service reminders stay in Maintenance. */
export function RenewalsPage() {
  const snap = useReminders();
  if (snap === undefined) return <Skeleton />;
  const renewals = snap.views.filter((v) => v.reminder.kind !== 'service');
  const open = renewals.filter((v) => v.reminder.status !== 'completed');
  const done = renewals.filter((v) => v.reminder.status === 'completed');
  return (
    <section aria-labelledby="renewals-title">
      <div className={HEAD}>
        <h1 id="renewals-title">Renewals</h1>
        <Button size="lg" render={<Link to="/reminders/new" />}>
          Add renewal
        </Button>
      </div>
      <p className={SMALL}>
        Road tax and insurance. Service reminders are under Maintenance, Reminders.
      </p>
      {renewals.length === 0 ? (
        <EmptyState
          title="No renewals yet."
          hint="Add a reminder and choose Insurance renewal or Road tax renewal."
        />
      ) : (
        <>
          <h2>Open</h2>
          {open.length === 0 ? (
            <p className={MUTED}>Nothing open.</p>
          ) : (
            <ul className={LIST} aria-label="Open renewals">
              {open.map((v) => (
                <ReminderItem key={v.reminder.id} view={v} basis={snap.basis} today={snap.today} />
              ))}
            </ul>
          )}
          {done.length > 0 ? (
            <>
              <h2>Done</h2>
              <ul className={LIST} aria-label="Completed renewals">
                {done.map((v) => (
                  <ReminderItem
                    key={v.reminder.id}
                    view={v}
                    basis={snap.basis}
                    today={snap.today}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

export function NotificationsPage() {
  return (
    <section aria-labelledby="notif-title">
      <h1 id="notif-title">Notifications</h1>
      <PushCard />
    </section>
  );
}
