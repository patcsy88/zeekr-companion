import { useState } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../api/errors';
import { SyncBadge } from '../components/SyncBadge';
import { useConnectivity, useRecords, useSession } from '../data/hooks';
import { loadMoreRecords } from '../data/repository';
import { formatDate } from '../lib/dates';
import { formatMyr } from '../lib/money';
import { Skeleton } from '../components/Skeleton';
import {
  EmptyState,
  HEAD,
  ITEM_BODY,
  ItemCard,
  LIST,
  META,
  MUTED,
  SMALL,
  TITLE,
} from '../components/ListParts';
import { ERROR } from '../components/Field';
import { Button } from '../components/ui/button';

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
      <div className={HEAD}>
        <h1 id="records-title">Service history</h1>
        <Button size="lg" render={<Link to="/records/new" />}>
          Add service
        </Button>
      </div>

      {snap === undefined ? (
        <Skeleton />
      ) : !snap.loaded && snap.views.length === 0 ? (
        <p className={MUTED}>
          {session.signedIn
            ? online
              ? 'Loading service records…'
              : 'Nothing saved on this device yet, and the server cannot be reached.'
            : 'Sign in to load your service records.'}
        </p>
      ) : snap.views.length === 0 ? (
        <EmptyState
          title="No service records yet."
          hint="Use Add service at the top to record the first one."
        />
      ) : (
        <ul className={LIST} aria-label="Service records, newest first">
          {snap.views.map(({ record, sync }) => (
            <ItemCard key={record.id}>
              <Link to={`/records/${record.id}`} className={ITEM_BODY}>
                <span className={TITLE}>{record.description}</span>
                <span className={META}>
                  <time dateTime={record.date}>{formatDate(record.date)}</time> ·{' '}
                  {record.odometer.toLocaleString()} km · {formatMyr(record.cost_minor)}
                </span>
              </Link>
              <SyncBadge sync={sync} />
            </ItemCard>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      ) : null}
      {snap?.nextCursor ? (
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            void more();
          }}
          disabled={loading || !online || !session.signedIn}
        >
          {loading ? 'Loading…' : 'Load older records'}
        </Button>
      ) : null}
      {snap?.nextCursor && !online ? (
        <p className={SMALL}>Older records are not saved on this device. Go online to load them.</p>
      ) : null}
    </section>
  );
}
