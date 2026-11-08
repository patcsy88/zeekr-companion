import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { request } from '../api/client';
import { ReminderForm, type ReminderFormValues } from '../components/ReminderForm';
import { useReminder } from '../data/hooks';
import { saveNewReminder, saveReminderEdit } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';
import { Skeleton } from '../components/Skeleton';

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

/** From a Rotate tyre event (AC-83): a Service reminder, prefilled, saved only by the owner. */
function readTyreState(state: unknown): { title: string; due_odometer: number } | null {
  if (typeof state !== 'object' || state === null) return null;
  const p = (state as Record<string, unknown>).tyrePrefill as Record<string, unknown> | undefined;
  if (typeof p !== 'object' || p === null) return null;
  if (typeof p.title !== 'string' || typeof p.due_odometer !== 'number') return null;
  if (!Number.isInteger(p.due_odometer) || p.due_odometer < 0 || p.due_odometer > 10_000_000)
    return null;
  return { title: p.title, due_odometer: p.due_odometer };
}

export function NewReminderPage() {
  const nav = useNavigate();
  const state: unknown = useLocation().state;
  const advisory = readAdvisoryState(state);
  const tyre = advisory ? null : readTyreState(state);
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
        prefill={advisory?.prefill ?? tyre ?? undefined}
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
  if (data === undefined) return <Skeleton />;
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
