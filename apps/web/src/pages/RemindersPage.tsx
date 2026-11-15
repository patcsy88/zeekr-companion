import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BasisNote, ReminderItem } from '../components/ReminderParts';
import { useConnectivity, useReminders, useSession } from '../data/hooks';
import { IN_APP_ONLY } from '../lib/reminderText';
import { Skeleton } from '../components/Skeleton';
import { EmptyState, HEAD, LIST, MUTED, SMALL } from '../components/ListParts';
import { Button } from '../components/ui/button';

export function RemindersPage() {
  const snap = useReminders();
  const { online } = useConnectivity();
  const session = useSession();
  const [showCompleted, setShowCompleted] = useState(false);

  if (snap === undefined) return <Skeleton />;
  const overdue = snap.views.filter((v) => v.reminder.status === 'overdue');
  const upcoming = snap.views.filter((v) => v.reminder.status === 'upcoming');
  const completed = snap.views.filter((v) => v.reminder.status === 'completed');
  const empty = snap.views.length === 0;

  return (
    <section aria-labelledby="rem-title">
      <div className={HEAD}>
        <h1 id="rem-title">Reminders</h1>
        <Button size="lg" render={<Link to="/reminders/new" />}>
          Add reminder
        </Button>
      </div>
      <p className={SMALL}>{IN_APP_ONLY}</p>
      <p className={SMALL} data-testid="status-computed-offline">
        Overdue and upcoming are worked out on this device from your reminders, your service records
        and today&apos;s date in Malaysia, so they are also right offline.
      </p>
      <BasisNote basis={snap.basis} />
      <p>
        <Link to="/reminders/template">Suggested service schedule</Link>
      </p>

      {!snap.loaded && empty ? (
        <p className={MUTED}>
          {session.signedIn
            ? online
              ? 'Loading reminders…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your reminders.'}
        </p>
      ) : empty ? (
        <EmptyState
          title="No reminders yet."
          hint="Use Add reminder at the top to set the first one."
        />
      ) : (
        <>
          <h2>Overdue</h2>
          {overdue.length === 0 ? (
            <p className={MUTED}>Nothing overdue.</p>
          ) : (
            <ul className={LIST} aria-label="Overdue reminders">
              {overdue.map((v) => (
                <ReminderItem key={v.reminder.id} view={v} basis={snap.basis} today={snap.today} />
              ))}
            </ul>
          )}
          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className={MUTED}>Nothing upcoming.</p>
          ) : (
            <ul className={LIST} aria-label="Upcoming reminders">
              {upcoming.map((v) => (
                <ReminderItem key={v.reminder.id} view={v} basis={snap.basis} today={snap.today} />
              ))}
            </ul>
          )}
          <label className="m-0 flex min-h-11 items-center gap-3 font-medium text-foreground">
            <input
              type="checkbox"
              className="m-0 size-5 shrink-0 accent-primary"
              checked={showCompleted}
              onChange={(e) => {
                setShowCompleted(e.target.checked);
              }}
            />
            Completed ({completed.length})
          </label>
          {showCompleted ? (
            completed.length === 0 ? (
              <p className={MUTED}>No completed reminders.</p>
            ) : (
              <ul className={LIST} aria-label="Completed reminders">
                {completed.map((v) => (
                  <ReminderItem
                    key={v.reminder.id}
                    view={v}
                    basis={snap.basis}
                    today={snap.today}
                  />
                ))}
              </ul>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
