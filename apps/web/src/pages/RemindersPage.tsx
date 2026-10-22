import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BasisNote, ReminderItem } from '../components/ReminderParts';
import { useConnectivity, useReminders, useSession } from '../data/hooks';
import { IN_APP_ONLY } from '../lib/reminderText';

export function RemindersPage() {
  const snap = useReminders();
  const { online } = useConnectivity();
  const session = useSession();
  const [showCompleted, setShowCompleted] = useState(false);

  if (snap === undefined) return <p role="status">Loading…</p>;
  const overdue = snap.views.filter((v) => v.reminder.status === 'overdue');
  const upcoming = snap.views.filter((v) => v.reminder.status === 'upcoming');
  const completed = snap.views.filter((v) => v.reminder.status === 'completed');
  const empty = snap.views.length === 0;

  return (
    <section aria-labelledby="rem-title">
      <div className="row">
        <h1 id="rem-title">Reminders</h1>
        <Link to="/reminders/new" className="button primary">
          Add reminder
        </Link>
      </div>
      <p className="muted small">{IN_APP_ONLY}</p>
      <p className="muted small" data-testid="status-computed-offline">
        Overdue and upcoming are worked out on this device from your reminders, your service records
        and today&apos;s date in Malaysia, so they are also right offline.
      </p>
      <BasisNote basis={snap.basis} />
      <p>
        <Link to="/reminders/template">Suggested service schedule</Link>
      </p>

      {!snap.loaded && empty ? (
        <p className="muted">
          {session.signedIn
            ? online
              ? 'Loading reminders…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your reminders.'}
        </p>
      ) : empty ? (
        <p className="muted">No reminders yet.</p>
      ) : (
        <>
          <h2>Overdue</h2>
          {overdue.length === 0 ? (
            <p className="muted">Nothing overdue.</p>
          ) : (
            <ul className="list" aria-label="Overdue reminders">
              {overdue.map((v) => (
                <ReminderItem key={v.reminder.id} view={v} basis={snap.basis} today={snap.today} />
              ))}
            </ul>
          )}
          <h2>Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="muted">Nothing upcoming.</p>
          ) : (
            <ul className="list" aria-label="Upcoming reminders">
              {upcoming.map((v) => (
                <ReminderItem key={v.reminder.id} view={v} basis={snap.basis} today={snap.today} />
              ))}
            </ul>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => {
                setShowCompleted(e.target.checked);
              }}
            />
            Completed ({completed.length})
          </label>
          {showCompleted ? (
            completed.length === 0 ? (
              <p className="muted">No completed reminders.</p>
            ) : (
              <ul className="list" aria-label="Completed reminders">
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
