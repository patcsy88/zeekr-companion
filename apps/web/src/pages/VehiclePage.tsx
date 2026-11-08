import { useState, type FormEvent, type ReactNode } from 'react';
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
import { Skeleton } from '../components/Skeleton';
import {
  ALL_TYRES,
  DRIVES,
  VARIANTS,
  findVariant,
  parseVariant,
  variantText,
} from '../lib/vehicleCatalogue';

/** A labelled native select, with the same hint and error wiring as TextField. */
function SelectField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        name={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function VehiclePage() {
  const snap = useVehicle();
  if (snap === undefined) return <Skeleton />;
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
          <div className="vehicle-hero" data-testid="vehicle-hero">
            <p className="vehicle-model">{view.vehicle.model}</p>
            {view.vehicle.variant ? <p className="muted">{view.vehicle.variant}</p> : null}
            <p className="badges">
              <span className="badge info">{view.vehicle.drive}</span>
              <span className="badge info">{view.vehicle.steering}</span>
            </p>
          </div>
          <h2 className="group-title">Identity</h2>
          <dl className="group">
            <Row label="Registration" value={view.vehicle.registration} />
            <Row label="VIN" value={view.vehicle.vin} />
          </dl>
          <h2 className="group-title">Ownership</h2>
          <dl className="group">
            <Row
              label="Purchase date"
              value={view.vehicle.purchase_date ? formatDate(view.vehicle.purchase_date) : null}
            />
            <Row label="Purchase price" value={formatMyr(view.vehicle.purchase_price_minor)} />
          </dl>
          <h2 className="group-title">Tyres</h2>
          <dl className="group">
            <Row label="Tyre specification" value={view.vehicle.tyre_spec} />
          </dl>
          <p>
            <Link to="/vehicle/tyres">Tyre changes and rotations</Link>
          </p>
          <Link to="/vehicle/edit" className="button">
            Edit
          </Link>
        </>
      )}
    </section>
  );
}

/** One label / value line in a grouped list. */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}

type Errs = Partial<
  Record<
    | 'model'
    | 'vin'
    | 'purchase_date'
    | 'price'
    | 'form'
    | 'registration'
    | 'variant'
    | 'year'
    | 'tyre_spec',
    string
  >
>;

export function VehicleEditPage() {
  const snap = useVehicle();
  const nav = useNavigate();
  if (snap === undefined) return <Skeleton />;
  return <VehicleForm initial={snap.view?.vehicle ?? null} onDone={() => void nav('/vehicle')} />;
}

function VehicleForm({ initial, onDone }: { initial: Vehicle | null; onDone: () => void }) {
  const [id] = useState(() => initial?.id ?? uuid());
  const [model, setModel] = useState(initial?.model ?? '7X');
  // A saved variant that is not in the list (older free text) is kept as its own option.
  const [parsed] = useState(() => (initial?.variant ? parseVariant(initial.variant) : null));
  const legacyVariant = initial?.variant && parsed === null ? initial.variant : null;
  const [variant, setVariant] = useState(parsed?.name ?? legacyVariant ?? '');
  const [year, setYear] = useState(parsed?.year != null ? String(parsed.year) : '');
  const [drive, setDrive] = useState(initial?.drive ?? 'AWD');
  const [driveTouched, setDriveTouched] = useState(false);
  const [registration, setRegistration] = useState(initial?.registration ?? '');
  const [vin, setVin] = useState(initial?.vin ?? '');
  const [purchaseDate, setPurchaseDate] = useState(initial?.purchase_date ?? '');
  const [price, setPrice] = useState(initial ? senToInput(initial.purchase_price_minor) : '0.00');
  const [tyre, setTyre] = useState(initial?.tyre_spec ?? '');
  // A saved tyre specification counts as the owner's own pick, so a variant change keeps it.
  const [tyreTouched, setTyreTouched] = useState(Boolean(initial?.tyre_spec));
  const [errors, setErrors] = useState<Errs>({});
  const [busy, setBusy] = useState(false);

  const entry = findVariant(variant);
  const tyreOptions = entry ? entry.tyres : ALL_TYRES;
  const legacyTyre =
    initial?.tyre_spec && !ALL_TYRES.includes(initial.tyre_spec) ? initial.tyre_spec : null;

  function chooseVariant(name: string) {
    setVariant(name);
    const v = findVariant(name);
    if (!v) {
      setYear('');
      return;
    }
    if (v.years.length === 1) setYear(String(v.years[0]));
    else if (!v.years.map(String).includes(year)) setYear('');
    if (!driveTouched) setDrive(v.drive);
    const keep = tyreTouched && (tyre === '' || v.tyres.includes(tyre) || tyre === legacyTyre);
    if (!keep) setTyre(v.tyres[0] ?? '');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errs = {};
    if (model.trim() === '') next.model = 'Model is required.';
    if (variant === '') next.variant = 'Choose a variant.';
    else if (entry && year === '') next.year = 'Choose a model year.';
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
        variant: entry ? variantText(variant, Number(year)) : variant,
        drive,
        steering: initial?.steering ?? 'RHD',
        registration: registration.trim() === '' ? null : registration.trim(),
        vin: v === '' ? null : v,
        purchase_date: purchaseDate === '' ? null : purchaseDate,
        purchase_price_minor: money.minor,
        currency: 'MYR',
        tyre_spec: tyre === '' ? null : tyre,
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
        <SelectField
          id="variant"
          label="Variant"
          hint="Malaysian 7X variants (press listings, unverified)."
          value={variant}
          onChange={chooseVariant}
          error={errors.variant}
        >
          <option value="">Choose a variant</option>
          {legacyVariant ? <option value={legacyVariant}>Current: {legacyVariant}</option> : null}
          {VARIANTS.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </SelectField>
        {entry ? (
          <SelectField
            id="model-year"
            label="Model year"
            value={year}
            onChange={setYear}
            error={errors.year}
          >
            <option value="">Choose a year</option>
            {entry.years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </SelectField>
        ) : null}
        <SelectField
          id="drive"
          label="Drive"
          hint="Filled in from the variant. You can change it."
          value={drive}
          onChange={(value) => {
            setDrive(value);
            setDriveTouched(true);
          }}
        >
          {(DRIVES as readonly string[]).includes(drive) ? null : (
            <option value={drive}>Current: {drive}</option>
          )}
          {DRIVES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
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
        <SelectField
          id="tyre"
          label="Tyre specification"
          hint="The first size is the variant's usual fit. Check the door-jamb placard."
          value={tyre}
          onChange={(value) => {
            setTyre(value);
            setTyreTouched(true);
          }}
          error={errors.tyre_spec}
        >
          <option value="">Not set</option>
          {legacyTyre ? <option value={legacyTyre}>Current: {legacyTyre}</option> : null}
          {tyreOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <p className="muted small">
          Steering {initial?.steering ?? 'RHD'} is fixed for this vehicle.
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
