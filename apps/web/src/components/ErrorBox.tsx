import type { QueueError } from '../storage/db';
import { isFutureDateIssue } from '../lib/forms';
import { UTC_DATE_EXPLANATION } from '../lib/dates';

/** Shows why a queued change was refused by the server, in words. */
export function FailedNotice({ error }: { error: QueueError }) {
  const dateIssue = error.details.find((d) => d.field === 'date' && isFutureDateIssue(d.issue));
  return (
    <div role="alert" className="notice bad">
      <p>
        <strong>This change was not accepted by the server.</strong>{' '}
        {error.status === 409
          ? 'A record with this ID already exists with different content.'
          : error.message}
      </p>
      {error.details.length > 0 ? (
        <ul>
          {error.details.map((d) => (
            <li key={`${d.field}:${d.issue}`}>
              {d.field}: {d.issue}
            </li>
          ))}
        </ul>
      ) : null}
      {dateIssue ? <p>{UTC_DATE_EXPLANATION}</p> : null}
    </div>
  );
}
