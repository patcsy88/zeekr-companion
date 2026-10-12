import { useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../api/errors';
import { SyncBadge } from '../components/SyncBadge';
import { useConnectivity, useRecords, useSession } from '../data/hooks';
import { loadMoreRecords } from '../data/repository';
import { formatDate } from '../lib/dates';
import { formatMyr } from '../lib/money';

export function RecordsPage() {
  const snap = useRecords();
  const { online } = useConnectivity();
  const session = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function more() {
    setLoading(true);
    setError(null);
    try {
      await loadMoreRecords();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="records-title">
      <div className="row">
        <h1 id="records-title">Service history</h1>
        <Link to="/records/new" className="button primary">
          Add service
        </Link>
      </div>

      {snap === undefined ? (
        <p role="status">Loading…</p>
      ) : !snap.loaded && snap.views.length === 0 ? (
        <p className="muted">
          {session.signedIn
            ? online
              ? 'Loading service records…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your service records.'}
        </p>
      ) : snap.views.length === 0 ? (
        <p className="muted">No service records yet.</p>
      ) : (
        <ul className="list" aria-label="Service records, newest first">
          {snap.views.map(({ record, sync }) => (
            <li key={record.id} className="item">
              <Link to={`/records/${record.id}`}>
                <span className="title">{record.description}</span>
                <span className="meta">
                  <time dateTime={record.date}>{formatDate(record.date)}</time> ·{' '}
                  {record.odometer.toLocaleString()} km · {formatMyr(record.cost_minor)}
                </span>
              </Link>
              <SyncBadge sync={sync} />
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {snap?.nextCursor ? (
        <button
          type="button"
          onClick={() => {
            void more();
          }}
          disabled={loading || !online || !session.signedIn}
        >
          {loading ? 'Loading…' : 'Load older records'}
        </button>
      ) : null}
      {snap?.nextCursor && !online ? (
        <p className="muted small">
          Older records are not saved on this device. Go online to load them.
        </p>
      ) : null}
    </section>
  );
}
