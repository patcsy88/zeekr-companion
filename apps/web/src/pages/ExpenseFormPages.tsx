import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExpenseForm, type ExpenseFormValues } from '../components/ExpenseForm';
import { useExpense } from '../data/hooks';
import { saveExpenseEdit, saveNewExpense } from '../data/mutations';
import { issuesByField } from '../lib/forms';
import { isUuid, uuid } from '../lib/uuid';

export function NewExpensePage() {
  const nav = useNavigate();
  // One id per form visit: pressing Save twice, or retrying, can only ever address the same expense.
  const id = useMemo(() => uuid(), []);
  async function submit(v: ExpenseFormValues) {
    await saveNewExpense({ id, ...v, currency: 'MYR' });
    void nav('/expenses');
  }
  return (
    <section aria-labelledby="new-exp-title">
      <h1 id="new-exp-title">Add expense</h1>
      <ExpenseForm submitLabel="Save" onSubmit={submit} onCancel={() => void nav('/expenses')} />
    </section>
  );
}

export function EditExpensePage() {
  const { id } = useParams();
  if (!isUuid(id)) return <p>Page not found.</p>;
  return <EditExpense id={id} />;
}

function EditExpense({ id }: { id: string }) {
  const nav = useNavigate();
  const data = useExpense(id);
  if (data === undefined) return <p role="status">Loading…</p>;
  if (data.view === null) return <p>Expense not found.</p>;
  const { expense, error } = data.view;
  async function submit(v: ExpenseFormValues) {
    await saveExpenseEdit(id, v);
    void nav(`/expenses/${id}`);
  }
  return (
    <section aria-labelledby="edit-exp-title">
      <h1 id="edit-exp-title">Edit expense</h1>
      <ExpenseForm
        initial={expense}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={() => void nav(`/expenses/${id}`)}
        serverIssues={error ? issuesByField(error.details) : undefined}
      />
    </section>
  );
}
