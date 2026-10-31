import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Vehicle } from '../api/types';
import { FailedNotice } from '../components/ErrorBox';
import { TextField } from '../components/Field';
import { LiveVehicleCard } from '../components/LiveVehicleCard';
import { SyncBadge } from '../components/SyncBadge';
import { useVehicle } from '../data/hooks';
import { saveVehicle } from '../data/mutations';
import { isIsoDate } from '../lib/dates';
import { formatDate } from '../lib/dates';
import { formatMyr, parseMyrToSen, senToInput } from '../lib/money';
import { uuid } from '../lib/uuid';
import { discardFailed, retryFailed } from '../storage/queue';
import { syncAll } from '../sync/engine';

export function VehiclePage() {
  const snap = useVehicle();
  if (snap === undefined) return <p role="status">Loading…</p>;
  const view = snap.view;
  return (
    <section aria-labelledby="vehicle-title">
      <div className="row">
        <h1 id="vehicle-title">Vehicle</h1>
        {view ? <SyncBadge sync={view.sync} /> : null}
      </div>
      <LiveVehicleCard />
      {view === null ? (
        <>
          <p className="muted">
            {snap.loaded ? 'No vehicle profile yet.' : 'Vehicle details have not been loaded yet.'}
          </p>
          <Link to="/vehicle/edit" className="button primary">
            {snap.loaded ? 'Create vehicle profile' : 'Create or edit anyway'}
          </Link>
        </>
      ) : (
        <>
          {view.sync === 'failed' && view.error ? (
            <>
              <FailedNotice error={view.error} />
              <div className="actions">
                <button
                  type="button"
                  onClick={() => {
                    void retryFailed(view.vehicle.id).then(() => syncAll(true));
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void discardFailed(view.vehicle.id);
                  }}
                >
                  Discard my change
                </button>
              </div>
            </>
          ) : null}
          <dl className="details">
            <dt>Model</dt>
            <dd>{view.vehicle.model}</dd>
            <dt>Variant</dt>
            <dd>{view.vehicle.variant || '—'}</dd>
            <dt>Drive</dt>
            <dd>{view.vehicle.drive}</dd>
            <dt>Steering</dt>
            <dd>{view.vehicle.steering}</dd>
            <dt>Registration</dt>
            <dd>{view.vehicle.registration ?? '—'}</dd>
            <dt>VIN</dt>
            <dd>{view.vehicle.vin ?? '—'}</dd>
            <dt>Purchase date</dt>
            <dd>{view.vehicle.purchase_date ? formatDate(view.vehicle.purchase_date) : '—'}</dd>
            <dt>Purchase price</dt>
            <dd>{formatMyr(view.vehicle.purchase_price_minor)}</dd>
            <dt>Tyre specification</dt>
            <dd>{view.vehicle.tyre_spec ?? '—'}</dd>
          </dl>
          <Link to="/vehicle/edit" className="button">
            Edit
          </Link>
        </>
      )}
    </section>
  );
}

type Errs = Partial<
  Record<
    'model' | 'vin' | 'purchase_date' | 'price' | 'form' | 'registration' | 'variant' | 'tyre_spec',
    string
  >
>;

export function VehicleEditPage() {
  const snap = useVehicle();
  const nav = useNavigate();
  if (snap === undefined) return <p role="status">Loading…</p>;
  return <VehicleForm initial={snap.view?.vehicle ?? null} onDone={() => void nav('/vehicle')} />;
}

function VehicleForm({ initial, onDone }: { initial: Vehicle | null; onDone: () => void }) {
  const [id] = useState(() => initial?.id ?? uuid());
  const [model, setModel] = useState(initial?.model ?? '7X');
  const [variant, setVariant] = useState(initial?.variant ?? '');
  const [registration, setRegistration] = useState(initial?.registration ?? '');
  const [vin, setVin] = useState(initial?.vin ?? '');
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchase_date ?? '');
  const [price, setPrice] = useState(initial ? senToInput(initial.purchase_price_minor) : '0.00');
  const [tyre, setTyre] = useState(initial?.tyre_spec ?? '');
  const [errors, setErrors] = useState<Errs>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errs = {};
    if (model.trim() === '') next.model = 'Model is required.';
    const v = vin.trim();
    if (v !== '' && v.length !== 17) next.vin = 'A VIN has 17 characters.';
    if (purchaseDate !== '' && !isIsoDate(purchaseDate)) next.purchase_date = 'Enter a valid date.';
    const money = parseMyrToSen(price);
    if (!money.ok) next.price = money.error;
    setErrors(next);
    if (Object.keys(next).length > 0 || !money.ok) return;
    setBusy(true);
    try {
      await saveVehicle({
        id,
        model: model.trim(),
        variant: variant.trim(),
        drive: initial?.drive ?? 'AWD',
        steering: initial?.steering ?? 'RHD',
        registration: registration.trim() === '' ? null : registration.trim(),
        vin: v === '' ? null : v,
        purchase_date: purchaseDate === '' ? null : purchaseDate,
        purchase_price_minor: money.minor,
        currency: 'MYR',
        tyre_spec: tyre.trim() === '' ? null : tyre.trim(),
      });
      onDone();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="vedit-title">
      <h1 id="vedit-title">{initial ? 'Edit vehicle' : 'Create vehicle profile'}</h1>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          id="model"
          label="Model"
          required
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
          }}
          error={errors.model}
        />
        <TextField
          id="variant"
          label="Variant"
          value={variant}
          onChange={(e) => {
            setVariant(e.target.value);
          }}
          error={errors.variant}
        />
        <TextField
          id="registration"
          label="Registration"
          autoComplete="off"
          value={registration}
          onChange={(e) => {
            setRegistration(e.target.value);
          }}
          error={errors.registration}
        />
        <TextField
          id="vin"
          label="VIN"
          hint="17 characters."
          autoComplete="off"
          value={vin}
          onChange={(e) => {
            setVin(e.target.value);
          }}
          error={errors.vin}
        />
        <TextField
          id="purchase-date"
          label="Purchase date"
          type="date"
          value={purchaseDate}
          onChange={(e) => {
            setPurchaseDate(e.target.value);
          }}
          error={errors.purchase_date}
        />
        <TextField
          id="price"
          label="Purchase price (MYR)"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
          }}
          error={errors.price}
        />
        <TextField
          id="tyre"
          label="Tyre specification"
          value={tyre}
          onChange={(e) => {
            setTyre(e.target.value);
          }}
          error={errors.tyre_spec}
        />
        <p className="muted small">
          Drive {initial?.drive ?? 'AWD'} and steering {initial?.steering ?? 'RHD'} are fixed for
          this vehicle.
        </p>
        {errors.form ? (
          <p role="alert" className="error">
            {errors.form}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
