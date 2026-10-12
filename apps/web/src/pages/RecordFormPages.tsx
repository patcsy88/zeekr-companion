import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RecordForm, type RecordFormValues } from '../components/RecordForm';
import { useRecord } from '../data/hooks';
import { saveNewRecord, saveRecordEdit } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

export function NewRecordPage() {
  const nav = useNavigate();
  // One id per form visit: pressing Save twice, or retrying, can only ever address the same record.
  const id = useMemo(() => uuid(), []);
  async function submit(v: RecordFormValues) {
    await saveNewRecord({ id, ...v, currency: 'MYR' });
    void nav('/');
  }
  return (
    <section aria-labelledby="new-title">
      <h1 id="new-title">Add service</h1>
      <RecordForm submitLabel="Save" onSubmit={submit} onCancel={() => void nav('/')} />
    </section>
  );
}

export function EditRecordPage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <EditRecord id={id} />;
}

function EditRecord({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useRecord(id);
  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) return <p>Record not found.</p>;
  const { record, error } = data.view;
  async function submit(v: RecordFormValues) {
    await saveRecordEdit(id, v);
    void nav(`/records/${id}`);
  }
  return (
    <section aria-labelledby="edit-title">
      <h1 id="edit-title">Edit service</h1>
      <RecordForm
        initial={record}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(`/records/${id}`)}
        serverIssues={error ? issuesByField(error.details) : undefined}
      />
    </section>
  );
}
