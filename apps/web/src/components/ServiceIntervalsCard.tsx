import { Link } from 'react-router-dom';
import { useTemplates, useVehicle } from '../data/hooks';
import { addMonths, formatDate } from '../lib/dates';
import { MUTED, SMALL } from './ListParts';
import { Card } from './ui/card';

/**
 * Service intervals from the official schedule template (FR-12, research M12), shown collapsed on
 * the Service tab. Due dates are the vehicle purchase date plus each checkpoint's months (AC-91).
 * Read-only: nothing here creates a reminder.
 */
export function ServiceIntervalsCard() {
  const templates = useTemplates();
  const vehicle = useVehicle();
  if (templates === undefined || vehicle === undefined) return null;
  const template = templates.items[0];
  if (!template) {
    return templates.loaded ? null : (
      <p className={SMALL} data-testid="intervals-not-loaded">
        Service intervals have not been loaded on this device yet. Open the app once while
        connected.
      </p>
    );
  }
  const purchase = vehicle.view?.vehicle.purchase_date ?? null;
  const src = template.source;
  return (
    <Card render={<details />} className="my-3 p-4" data-testid="service-intervals">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        Service intervals: every {template.interval.km.toLocaleString()} km or{' '}
        {template.interval.months} months, {template.interval.rule}
      </summary>
      <p className={`mt-3 mb-0 ${SMALL}`}>
        {purchase === null ? (
          <>
            Add the purchase date in the <Link to="/vehicle">vehicle profile</Link> to see due
            dates.
          </>
        ) : (
          <>Due dates count from the purchase date, {formatDate(purchase)}.</>
        )}
      </p>
      <ul className="m-0 mt-3 grid list-none gap-3 p-0" aria-label="Service checkpoints">
        {template.checkpoints.map((c) => {
          const due = purchase === null ? null : addMonths(purchase, c.months);
          return (
            <li key={c.number}>
              <span className="font-semibold">
                {c.km.toLocaleString()} km or{' '}
                {due === null ? (
                  `${c.months} months`
                ) : (
                  <time dateTime={due}>{formatDate(due)}</time>
                )}
              </span>
              <span className={`block ${SMALL}`}>
                {c.work_items_stated
                  ? `${c.work_items.join('; ')}.`
                  : 'Work items not stated by the source.'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={`mt-3 mb-0 ${SMALL}`} data-testid="intervals-source">
        Source: <a href={src.url}>{src.title}</a>, retrieved {src.retrieved}. {template.caveat}
      </p>
      <p className={`mt-2 mb-0 ${MUTED}`}>
        <Link to="/reminders/template">Set up reminders from this schedule</Link>
      </p>
    </Card>
  );
}
