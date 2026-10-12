import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { setToken } from '../src/auth/session';
import { removeRecord } from '../src/data/mutations';
import { readRecords, refreshRecord, refreshRecords } from '../src/data/repository';
import { listQueue } from '../src/storage/queue';
import { syncAll } from '../src/sync/engine';
import { fake, server } from './server';

const ID = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const rec = (id: string) => ({
  id,
  date: '2026-10-01',
  odometer: 1,
  provider: null,
  description: `Record ${id.slice(0, 2)}`,
  cost_minor: 100,
  currency: 'MYR',
  notes: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
}

async function seeded() {
  setToken('tok-test', 3600);
  fake.records.set(ID, rec(ID));
  fake.records.set(OTHER, rec(OTHER));
  await syncAll(true);
  expect((await readRecords()).views).toHaveLength(2);
}

describe('D1: a delete cannot be undone by a refresh that was already in flight', () => {
  it('list refresh that read the server BEFORE the delete finishes AFTER it', async () => {
    await seeded();
    const g = gate();
    server.use(
      http.get('*/api/v1/service-records', async () => {
        const items = [...fake.records.values()]; // snapshot at request time, still has ID
        await g.promise;
        return HttpResponse.json({ items, next_cursor: null });
      }),
    );
    const refreshing = refreshRecords();
    await removeRecord(ID); // DELETE answered 204, cache updated, queue empty
    expect(await listQueue()).toHaveLength(0);
    g.open();
    await refreshing.catch(() => undefined);
    expect((await readRecords()).views.map((v) => v.record.id)).toEqual([OTHER]);
  });

  it('slow DELETE response with a refresh completing in between', async () => {
    await seeded();
    const deleteGate = gate();
    const listGate = gate();
    server.use(
      http.delete('*/api/v1/service-records/:id', async ({ params }) => {
        fake.records.delete(String(params.id)); // server deleted it ...
        await deleteGate.promise; // ... but the answer is slow
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('*/api/v1/service-records', async () => {
        const items = [...fake.records.values()].concat([rec(ID)]); // stale snapshot (pre-delete)
        await listGate.promise;
        return HttpResponse.json({ items, next_cursor: null });
      }),
    );
    const deleting = removeRecord(ID);
    const refreshing = refreshRecords();
    listGate.open();
    await refreshing.catch(() => undefined);
    // While the DELETE is still unanswered the record must stay hidden.
    expect((await readRecords()).views.map((v) => v.record.id)).toEqual([OTHER]);
    deleteGate.open();
    await deleting;
    expect((await readRecords()).views.map((v) => v.record.id)).toEqual([OTHER]);
    expect(await listQueue()).toHaveLength(0);
  });

  it('a record-detail refresh in flight cannot re-add a deleted record', async () => {
    await seeded();
    const g = gate();
    let first = true;
    server.use(
      http.get('*/api/v1/service-records/:id', async ({ params }) => {
        const snapshot = fake.records.get(String(params.id)); // server state when the request arrives
        if (first) {
          first = false;
          await g.promise; // the first answer is slow and predates the delete
        }
        return snapshot
          ? HttpResponse.json(snapshot)
          : HttpResponse.json(
              { error: { code: 'not_found', message: 'x', details: [] } },
              { status: 404 },
            );
      }),
    );
    const refreshing = refreshRecord(ID);
    await removeRecord(ID);
    g.open();
    await refreshing.catch(() => undefined);
    expect((await readRecords()).views.map((v) => v.record.id)).toEqual([OTHER]);
  });

  it('repeated add then delete with a refresh racing each time ends with an empty list', async () => {
    setToken('tok-test', 3600);
    const { saveNewRecord } = await import('../src/data/mutations');
    await syncAll(true);
    for (let i = 0; i < 6; i++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${String(i)}`;
      const g = gate();
      server.use(
        http.get('*/api/v1/service-records', async () => {
          const items = [...fake.records.values()];
          await g.promise;
          return HttpResponse.json({ items, next_cursor: null });
        }),
      );
      await saveNewRecord({ ...rec(id), currency: 'MYR' });
      const refreshing = refreshRecords(); // snapshot contains the new record
      await removeRecord(id);
      g.open();
      await refreshing.catch(() => undefined);
      server.resetHandlers();
      expect((await readRecords()).views, `trial ${String(i)}`).toHaveLength(0);
    }
    expect(fake.records.size).toBe(0);
  });
});

describe('D1 root cause: the detail page must not fetch a record it has just deleted', () => {
  it('no GET /service-records/{id} is issued while or after the DELETE runs', async () => {
    const { render, screen, waitFor, within } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const { App } = await import('../src/App');
    fake.records.set(ID, rec(ID));
    setToken('tok-test', 3600);
    const del = gate();
    let detailGets = 0;
    server.use(
      http.get('*/api/v1/service-records/:id', () => {
        detailGets += 1;
        return fake.records.has(ID)
          ? HttpResponse.json(rec(ID)) // a real server still has it until the DELETE lands
          : HttpResponse.json(
              { error: { code: 'not_found', message: 'x', details: [] } },
              { status: 404 },
            );
      }),
      http.delete('*/api/v1/service-records/:id', async ({ params }) => {
        await del.promise;
        fake.records.delete(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: /Record 66/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await new Promise((r) => setTimeout(r, 150)); // DELETE still unanswered
    expect(detailGets).toBe(0);
    del.open();
    await waitFor(() => {
      expect(fake.records.has(ID)).toBe(false);
    });
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /Record 66/ })).not.toBeInTheDocument();
    });
    expect(detailGets).toBe(0);
  });
});
