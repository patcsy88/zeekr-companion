import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReminderForm, type ReminderFormValues } from '../components/ReminderForm';
import { useReminder } from '../data/hooks';
import { saveNewReminder, saveReminderEdit } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

export function NewReminderPage() {
  const nav = useNavigate();
  const id = useMemo(() => uuid(), []);
  async function submit(v: ReminderFormValues) {
    await saveNewReminder({ id, ...v });
    void nav('/reminders');
  }
  return (
    <section aria-labelledby="new-rem-title">
      <h1 id="new-rem-title">Add reminder</h1>
      <ReminderForm submitLabel="Save" onSubmit={submit} onCancel={() => void nav('/reminders')} />
    </section>
  );
}

export function EditReminderPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <EditReminder id={id} />;
}

function EditReminder({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useReminder(id);
  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) return <p>Reminder not found.</p>;
  const { reminder, error } = data.view;
  async function submit(v: ReminderFormValues) {
    await saveReminderEdit(id, v);
    void nav(`/reminders/${id}`);
  }
  return (
    <section aria-labelledby="edit-rem-title">
      <h1 id="edit-rem-title">Edit reminder</h1>
      <ReminderForm
        initial={reminder}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(`/reminders/${id}`)}
        serverIssues={error ? issuesByField(error.details) : undefined}
      />
    </section>
  );
}
