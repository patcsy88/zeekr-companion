import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { request } from '../api/client';
import { ReminderForm, type ReminderFormValues } from '../components/ReminderForm';
import { useReminder } from '../data/hooks';
import { saveNewReminder, saveReminderEdit } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

interface AdvisoryState {
  prefill: { title: string; due_date: string | null; due_odometer: number | null };
  proposalId: string;
}

function readAdvisoryState(state: unknown): AdvisoryState | null {
  if (typeof state !== 'object' || state === null) return null;
  const s = state as Record<string, unknown>;
  const p = s.prefill as Record<string, unknown> | null | undefined;
  if (typeof s.proposalId !== 'string' || !isUuid(s.proposalId)) return null;
  if (typeof p !== 'object' || p === null || typeof p.title !== 'string') return null;
  return {
    proposalId: s.proposalId,
    prefill: {
      title: p.title,
      due_date: typeof p.due_date === 'string' ? p.due_date : null,
      due_odometer: typeof p.due_odometer === 'number' ? p.due_odometer : null,
    },
  };
}

export function NewReminderPage() {
  const nav = useNavigate();
  const advisory = readAdvisoryState(useLocation().state);
  const id = useMemo(() => uuid(), []);
  async function submit(v: ReminderFormValues) {
    await saveNewReminder({ id, ...v });
    if (advisory) {
      // The reminder is saved. Record the decision; if this fails the suggestion stays open.
      try {
        await request({
          method: 'PATCH',
          path: `/advisory/proposals/${advisory.proposalId}`,
          body: { status: 'accepted' },
        });
      } catch {
        /* the owner can accept or dismiss it again from the Advisory screen */
      }
      void nav('/advisory');
      return;
    }
    void nav('/reminders');
  }
  return (
    <section aria-labelledby="new-rem-title">
      <h1 id="new-rem-title">Add reminder</h1>
      <ReminderForm
        prefill={advisory?.prefill}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => void nav(advisory ? '/advisory' : '/reminders')}
      />
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
