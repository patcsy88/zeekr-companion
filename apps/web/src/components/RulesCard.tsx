import { useCallback, useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import type {
  NotificationRule,
  NotificationRuleInput,
  NotificationRuleOptions,
  RuleCondition,
  RuleOption,
} from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';
import { formatTimestamp } from '../lib/dates';
import { ConfirmDialog } from './ConfirmDialog';
import { ACTIONS, ERROR, FORM, HINT, SelectField, TextField } from './Field';
import { EmptyState, ItemCard, LIST, META, NOTICE, TITLE } from './ListParts';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from '../lib/cn';

const RULES = '/notification-rules';

interface Form {
  name: string;
  match: 'all' | 'any';
  cooldown: string;
  enabled: boolean;
  codes: Record<string, string[]>;
  where: '' | 'outside' | 'inside';
  radius: string;
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

function blank(options: NotificationRuleOptions): Form {
  return {
    name: '',
    match: 'all',
    cooldown: String(options.limits.cooldown_minutes_default),
    enabled: true,
    codes: {},
    where: '',
    radius: '5',
  };
}

function toForm(rule: NotificationRule): Form {
  const codes: Record<string, string[]> = {};
  let where: Form['where'] = '';
  let radius = '5';
  for (const c of rule.conditions) {
    if (c.field === 'location') {
      where = c.where;
      radius = String(c.radius_km);
    } else {
      codes[c.field] = [...c.codes];
    }
  }
  return {
    name: rule.name,
    match: rule.match,
    cooldown: String(rule.cooldown_minutes),
    enabled: rule.enabled,
    codes,
    where,
    radius,
  };
}

/** Builds the request body from the form, or says what is wrong. The server stays the authority. */
function toInput(
  f: Form,
  options: NotificationRuleOptions,
): { input: NotificationRuleInput } | { problem: string } {
  const { limits } = options;
  const name = f.name.trim();
  if (name.length < 1 || name.length > 60) return { problem: 'The name needs 1 to 60 characters.' };
  const cooldown = Number(f.cooldown);
  if (
    f.cooldown.trim() === '' ||
    !Number.isInteger(cooldown) ||
    cooldown < limits.cooldown_minutes_min ||
    cooldown > limits.cooldown_minutes_max
  )
    return {
      problem: `The cooldown must be a whole number from ${limits.cooldown_minutes_min} to ${limits.cooldown_minutes_max} minutes.`,
    };
  const conditions: RuleCondition[] = [];
  for (const field of options.fields) {
    if (field.field === 'location') {
      if (f.where === '') continue;
      const radius = Number(f.radius);
      if (f.radius.trim() === '' || !(radius > 0 && radius <= limits.radius_km_max))
        return { problem: `The radius must be above 0 and at most ${limits.radius_km_max} km.` };
      conditions.push({ field: 'location', where: f.where, radius_km: radius });
    } else {
      const ticked = f.codes[field.field] ?? [];
      if (ticked.length === 0) continue;
      conditions.push({ field: field.field, codes: ticked } as RuleCondition);
    }
  }
  if (conditions.length < 1) return { problem: 'Choose at least one condition.' };
  if (conditions.length > limits.max_conditions)
    return { problem: `A rule can have at most ${limits.max_conditions} conditions.` };
  return {
    input: { name, match: f.match, cooldown_minutes: cooldown, enabled: f.enabled, conditions },
  };
}

function labelOf(options: RuleOption[], code: string): string {
  return options.find((o) => o.code === code)?.label ?? code;
}

function summary(rule: NotificationRule, options: NotificationRuleOptions): string {
  const parts = rule.conditions.map((c) => {
    const field = options.fields.find((x) => x.field === c.field);
    const name = field?.name ?? c.field;
    if (c.field === 'location')
      return `${name}: ${labelOf(field?.options ?? [], c.where)}, ${c.radius_km} km`;
    return `${name}: ${c.codes.map((code) => labelOf(field?.options ?? [], code)).join(', ')}`;
  });
  return parts.join(rule.match === 'all' ? ' and ' : ' or ');
}

function Unverified({ option }: { option: RuleOption }) {
  return option.verified ? null : (
    <span className="text-muted-foreground text-sm"> (unverified)</span>
  );
}

/** One drop-down tick list. Any ticked value matches. */
function TickList({
  title,
  options,
  chosen,
  onChange,
}: {
  title: string;
  options: RuleOption[];
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <details className="rounded-lg border border-input px-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium">
        {title}: {chosen.length === 0 ? 'not used' : `${chosen.length} chosen`}
      </summary>
      <div className="flex flex-col gap-1 pb-3">
        {options.map((o) => (
          <label
            key={o.code}
            className="m-0 flex min-h-11 items-center gap-3 font-normal text-foreground"
          >
            <Checkbox
              checked={chosen.includes(o.code)}
              onCheckedChange={(checked) => {
                onChange(checked ? [...chosen, o.code] : chosen.filter((c) => c !== o.code));
              }}
            />{' '}
            <span>
              {o.label}
              <Unverified option={o} />
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}

function RuleForm({
  options,
  initial,
  editing,
  busy,
  error,
  onSave,
  onCancel,
}: {
  options: NotificationRuleOptions;
  initial: Form;
  editing: boolean;
  busy: boolean;
  error: string | null;
  onSave: (input: NotificationRuleInput) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const location = options.fields.find((x) => x.field === 'location');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = toInput(f, options);
    if ('problem' in r) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    onSave(r.input);
  }

  return (
    <form className={FORM} onSubmit={submit} aria-label={editing ? 'Edit rule' : 'New rule'}>
      <TextField
        id="rule-name"
        label="Name"
        value={f.name}
        maxLength={60}
        onChange={(e) => {
          setF({ ...f, name: e.target.value });
        }}
      />
      <SelectField
        id="rule-match"
        label="Match"
        hint="A rule is all of its conditions or any of them. For a mix, use two rules."
        value={f.match}
        onChange={(e) => {
          setF({ ...f, match: e.target.value === 'any' ? 'any' : 'all' });
        }}
      >
        {options.match.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </SelectField>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 font-medium text-foreground">Conditions</legend>
        <p className={HINT}>
          Open a list and tick the values. A list with nothing ticked is not used. Up to{' '}
          {options.limits.max_conditions} conditions. The names come from a public integration and
          are not yet confirmed on this car.
        </p>
        {options.fields
          .filter((x) => x.field !== 'location')
          .map((x) => (
            <TickList
              key={x.field}
              title={x.name}
              options={x.options}
              chosen={f.codes[x.field] ?? []}
              onChange={(next) => {
                setF({ ...f, codes: { ...f.codes, [x.field]: next } });
              }}
            />
          ))}
        {location ? (
          <div className="flex flex-col gap-2 rounded-lg border border-input p-3">
            <SelectField
              id="rule-where"
              label={location.name}
              hint="Uses the home and office points from the Geofence tab. Office counts as inside."
              value={f.where}
              onChange={(e) => {
                setF({ ...f, where: e.target.value as Form['where'] });
              }}
            >
              <option value="">Not used</option>
              {location.options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                  {o.verified ? '' : ' (unverified)'}
                </option>
              ))}
            </SelectField>
            {f.where !== '' ? (
              <TextField
                id="rule-radius"
                label="Radius (km)"
                inputMode="decimal"
                value={f.radius}
                onChange={(e) => {
                  setF({ ...f, radius: e.target.value });
                }}
              />
            ) : null}
          </div>
        ) : null}
      </fieldset>
      <TextField
        id="rule-cooldown"
        label="Cooldown (minutes)"
        hint={`0 means none. At most ${options.limits.cooldown_minutes_max}.`}
        inputMode="numeric"
        value={f.cooldown}
        onChange={(e) => {
          setF({ ...f, cooldown: e.target.value });
        }}
      />
      <label className="m-0 flex min-h-11 items-center gap-3 font-normal text-foreground">
        <Checkbox
          checked={f.enabled}
          onCheckedChange={(checked) => {
            setF({ ...f, enabled: checked });
          }}
        />{' '}
        Rule is on
      </label>
      {editing ? (
        <p className={HINT}>
          Changing the match or the conditions lets this rule send once more when it matches.
        </p>
      ) : null}
      {(problem ?? error) ? (
        <p role="alert" className={ERROR}>
          {problem ?? error}
        </p>
      ) : null}
      <div className={ACTIONS}>
        <Button type="submit" size="lg" disabled={busy}>
          Save rule
        </Button>
        <Button variant="outline" size="lg" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Rules on this page (ADR-015): when the car's states match, one push with the Central locking text. */
export function RulesCard() {
  const session = useSession();
  const { online } = useConnectivity();
  const [options, setOptions] = useState<NotificationRuleOptions | null>(null);
  const [rules, setRules] = useState<NotificationRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ id: string | null; initial: Form } | null>(null);
  const [removing, setRemoving] = useState<NotificationRule | null>(null);
  const ready = session.signedIn && online;

  const load = useCallback(async () => {
    const [o, r] = await Promise.all([
      request<NotificationRuleOptions>({ method: 'GET', path: `${RULES}/options` }),
      request<NotificationRule[]>({ method: 'GET', path: RULES }),
    ]);
    setOptions(o.data);
    setRules(r.data);
    setError(null);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      try {
        const [o, r] = await Promise.all([
          request<NotificationRuleOptions>({ method: 'GET', path: `${RULES}/options` }),
          request<NotificationRule[]>({ method: 'GET', path: RULES }),
        ]);
        if (!live) return;
        setOptions(o.data);
        setRules(r.data);
        setError(null);
      } catch (e) {
        if (live) setError(message(e, 'Could not load the rules.'));
      }
    })();
    return () => {
      live = false;
    };
  }, [ready]);

  async function save(input: NotificationRuleInput) {
    if (!form) return;
    setBusy(true);
    setFormError(null);
    try {
      if (form.id === null) await request({ method: 'POST', path: RULES, body: input });
      else await request({ method: 'PUT', path: `${RULES}/${form.id}`, body: input });
      await load();
      setForm(null);
      setNotice('Rule saved.');
    } catch (e) {
      setFormError(message(e, 'Could not save the rule.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await request({ method: 'DELETE', path: `${RULES}/${removing.id}` });
      setRemoving(null);
      await load();
      setNotice('Rule deleted.');
    } catch (e) {
      setError(message(e, 'Could not delete the rule.'));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <p className={HINT} data-testid="rules-offline">
        Rules need a sign-in and a connection to the server.
      </p>
    );
  } else if (!options || !rules) {
    body = error ? null : <p className={HINT}>Loading…</p>;
  } else if (form) {
    body = (
      <RuleForm
        options={options}
        initial={form.initial}
        editing={form.id !== null}
        busy={busy}
        error={formError}
        onSave={(input) => void save(input)}
        onCancel={() => {
          setForm(null);
          setFormError(null);
        }}
      />
    );
  } else {
    const full = rules.length >= options.limits.max_rules;
    body = (
      <>
        {options.push_ready ? null : (
          <p role="status" className={cn(NOTICE.warn, 'my-0')} data-testid="rules-push-off">
            Push is not set up on the host. Rules can be saved, but nothing will be sent.
          </p>
        )}
        <p className={HINT} data-testid="rules-count">
          {rules.length} of {options.limits.max_rules} rules.
        </p>
        {rules.length === 0 ? (
          <EmptyState
            title="No rules yet."
            hint="Add a rule to get a notification with the Central locking state."
          />
        ) : (
          <ul className={LIST} aria-label="Rules">
            {rules.map((r) => (
              <ItemCard key={r.id} className="flex-col items-stretch gap-2 p-3">
                <span className={TITLE}>
                  {r.name}
                  {r.enabled ? '' : ' (off)'}
                </span>
                <span className={META}>{summary(r, options)}</span>
                <span className={META}>
                  Last check: {r.last_result}
                  {r.last_sent_at ? `. Last sent ${formatTimestamp(r.last_sent_at)}.` : '.'}
                </span>
                <div className={ACTIONS}>
                  <Button
                    variant="outline"
                    size="lg"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => {
                      setNotice(null);
                      setForm({ id: r.id, initial: toForm(r) });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      setRemoving(r);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </ItemCard>
            ))}
          </ul>
        )}
        <div className={ACTIONS}>
          <Button
            size="lg"
            disabled={full}
            onClick={() => {
              setNotice(null);
              setForm({ id: null, initial: blank(options) });
            }}
          >
            Add rule
          </Button>
        </div>
        {full ? (
          <p className={HINT}>The limit of {options.limits.max_rules} rules is reached.</p>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="rules-title" className="mt-6 grid gap-2" data-testid="rules-card">
      <h2 id="rules-title" className="m-0 text-lg">
        Rules
      </h2>
      <p className={HINT}>
        When the car&apos;s states match a rule, one notification says whether central locking is
        locked. It sends once when a rule first matches, then waits for the cooldown. It never
        includes a place, and it never sends a command to the car.
      </p>
      {error ? (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={cn(NOTICE.info, 'my-0')}>
          {notice}
        </p>
      ) : null}
      {body}
      <ConfirmDialog
        open={removing !== null}
        title="Delete this rule?"
        description={removing ? `“${removing.name}” will stop sending notifications.` : ''}
        confirmLabel="Delete rule"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(null);
        }}
      />
    </section>
  );
}
