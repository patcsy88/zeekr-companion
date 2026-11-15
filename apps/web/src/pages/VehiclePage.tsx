import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Vehicle } from '../api/types';
import { FailedNotice } from '../components/ErrorBox';
import { ACTIONS, ERROR, FORM, HINT, SelectField, TextField } from '../components/Field';
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
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { cn } from '../lib/cn';
import {
  ALL_TYRES,
  DRIVES,
  VARIANTS,
  findVariant,
  parseVariant,
  variantText,
} from '../lib/vehicleCatalogue';

/** Group heading and card list, iOS grouped-list style. */
const GROUP_TITLE =
  'mx-1 mt-5 mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider';

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
          <Button size="lg" render={<Link to="/vehicle/edit" />}>
            {snap.loaded ? 'Create vehicle profile' : 'Create or edit anyway'}
          </Button>
        </>
      ) : (
        <>
          {view.sync === 'failed' && view.error ? (
            <>
              <FailedNotice error={view.error} />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    void retryFailed(view.vehicle.id).then(() => syncAll(true));
                  }}
                >
                  Retry
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    void discardFailed(view.vehicle.id);
                  }}
                >
                  Discard my change
                </Button>
              </div>
            </>
          ) : null}
          <Card className="my-3 gap-1 p-5" data-testid="vehicle-hero">
            <p className="m-0 font-bold text-2xl tracking-tight">{view.vehicle.model}</p>
            {view.vehicle.variant ? (
              <p className="m-0 text-muted-foreground">{view.vehicle.variant}</p>
            ) : null}
            <p className="m-0 mt-2 flex flex-wrap gap-1.5">
              <Badge variant="info" size="lg">
                {view.vehicle.drive}
              </Badge>
              <Badge variant="info" size="lg">
                {view.vehicle.steering}
              </Badge>
            </p>
          </Card>
          <h2 className={GROUP_TITLE}>Identity</h2>
          <Group>
            <Row label="Registration" value={view.vehicle.registration} />
            <Row label="VIN" value={view.vehicle.vin} />
          </Group>
          <h2 className={GROUP_TITLE}>Ownership</h2>
          <Group>
            <Row
              label="Purchase date"
              value={view.vehicle.purchase_date ? formatDate(view.vehicle.purchase_date) : null}
            />
            <Row label="Purchase price" value={formatMyr(view.vehicle.purchase_price_minor)} />
          </Group>
          <h2 className={GROUP_TITLE}>Tyres</h2>
          <Group>
            <Row label="Tyre specification" value={view.vehicle.tyre_spec} />
          </Group>
          <p>
            <Link to="/vehicle/tyres">Tyre changes and rotations</Link>
          </p>
          <Button variant="outline" size="lg" render={<Link to="/vehicle/edit" />}>
            Edit
          </Button>
        </>
      )}
    </section>
  );
}

/** A grouped list of label / value lines in a COSS card. */
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card render={<dl />} className={cn('m-0 mb-3 overflow-hidden', className)}>
      {children}
    </Card>
  );
}

/** One label / value line in a grouped list. */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 not-first:border-border not-first:border-t">
      <dt>{label}</dt>
      <dd className="m-0 text-right text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
        {value ?? '—'}
      </dd>
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
      <form onSubmit={(e) => void submit(e)} noValidate className={FORM}>
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
          onChange={(e) => {
            chooseVariant(e.target.value);
          }}
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
            onChange={(e) => {
              setYear(e.target.value);
            }}
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
          onChange={(e) => {
            setDrive(e.target.value);
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
          onChange={(e) => {
            setTyre(e.target.value);
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
        <p className={HINT}>Steering {initial?.steering ?? 'RHD'} is fixed for this vehicle.</p>
        {errors.form ? (
          <p role="alert" className={ERROR}>
            {errors.form}
          </p>
        ) : null}
        <div className={ACTIONS}>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" size="lg" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
