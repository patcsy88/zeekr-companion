import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton';
import { TyreEventForm, type TyreEventFormValues } from '../components/TyreEventForm';
import { useTyreEvent, useTyreEvents, useVehicle } from '../data/hooks';
import { saveNewTyreEvent, saveTyreEventEdit } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

export function NewTyreEventPage() {
  const nav = useNavigate();
  const snap = useTyreEvents();
  const vehicle = useVehicle();
  // One id per form visit: pressing Save twice, or retrying, can only ever address the same event.
  const id = useMemo(() => uuid(), []);
  if (snap === undefined || vehicle === undefined) return <Skeleton />;
  async function submit(v: TyreEventFormValues) {
    await saveNewTyreEvent({ id, ...v, currency: 'MYR' });
    void nav('/vehicle/tyres');
  }
  return (
    <section aria-labelledby="new-tyre-title">
      <h1 id="new-tyre-title">Add tyre event</h1>
      <TyreEventForm
        prefill={{
          odometer: snap.basis?.km ?? null,
          size: vehicle.view?.vehicle.tyre_spec ?? null,
        }}
        submitLabel="Save"
        onSubmit={submit}
        onCancel={() => void nav('/vehicle/tyres')}
      />
    </section>
  );
}

export function EditTyreEventPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <EditTyreEvent id={id} />;
}

function EditTyreEvent({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useTyreEvent(id);
  if (data === undefined) return <Skeleton />;
  if (data.view === null) return <p>Tyre event not found.</p>;
  const { event, error } = data.view;
  async function submit(v: TyreEventFormValues) {
    await saveTyreEventEdit(id, v);
    void nav(`/vehicle/tyres/${id}`);
  }
  return (
    <section aria-labelledby="edit-tyre-title">
      <h1 id="edit-tyre-title">Edit tyre event</h1>
      <TyreEventForm
        initial={event}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(`/vehicle/tyres/${id}`)}
        serverIssues={error ? issuesByField(error.details) : undefined}
      />
    </section>
  );
}
