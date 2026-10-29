import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../api/client';
import type {
  AdvisoryProposal,
  AdvisoryProposalList,
  AdvisoryRun,
  AdvisoryStatus,
} from '../api/types';
import { useConnectivity, useSession } from '../data/hooks';

const CONDITION_LABELS: Record<AdvisoryProposal['condition'], string> = {
  date_vs_km_warranty: 'Warranty km limit may be reached before its end date',
  date_vs_km_service: 'Service km may be reached before its due date',
  charging_cost_drift: 'Charging cost per kWh differs from your recent average',
};

const EXPLANATION_NOTES: Record<AdvisoryProposal['explanation_status'], string> = {
  model: 'Written by a language model. It is an opinion, not a fact.',
  disabled: 'No model explanation: the model is switched off.',
  unavailable: 'No model explanation: the model is not available.',
  limit_reached: 'No model explanation: the monthly call limit was reached.',
  invalid_output: 'No model explanation: the model reply was not usable.',
};

const INPUT_LABELS: Record<string, string> = {
  km_to_limit: 'km left to limit',
  days_to_expiry: 'days to date',
  projected_limit_date: 'projected date the km limit is reached',
  latest_cost_per_kwh_sen: 'latest cost per kWh (sen)',
  average_cost_per_kwh_sen: 'recent average per kWh (sen)',
  latest_date: 'latest charge date',
};

export function AdvisoryPage() {
  const nav = useNavigate();
  const session = useSession();
  const { online } = useConnectivity();
  const [items, setItems] = useState<AdvisoryProposal[] | null>(null);
  const [status, setStatus] = useState<AdvisoryStatus | null>(null);
  const [lastRun, setLastRun] = useState<AdvisoryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => {
    setReloads((n) => n + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (!session.signedIn || !online) return;
    let live = true;
    void (async () => {
      try {
        const [p, s] = await Promise.all([
          request<AdvisoryProposalList>({
            method: 'GET',
            path: '/advisory/proposals?status=proposed',
          }),
          request<AdvisoryStatus>({ method: 'GET', path: '/advisory/status' }),
        ]);
        if (!live) return;
        setItems(p.data.items);
        setStatus(s.data);
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load.');
      }
    })();
    return () => {
      live = false;
    };
  }, [session.signedIn, online, reloads]);

  async function runChecks() {
    setBusy(true);
    try {
      const r = await request<AdvisoryRun>({ method: 'POST', path: '/advisory/checks' });
      setLastRun(r.data);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the checks.');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(p: AdvisoryProposal) {
    setBusy(true);
    try {
      await request({
        method: 'PATCH',
        path: `/advisory/proposals/${p.id}`,
        body: { status: 'dismissed' },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss.');
    } finally {
      setBusy(false);
    }
  }

  function accept(p: AdvisoryProposal) {
    void nav('/reminders/new', {
      state: { prefill: p.suggestion, proposalId: p.id },
    });
  }

  if (!session.signedIn || !online) {
    return (
      <section aria-labelledby="adv-title">
        <h1 id="adv-title">Advisory</h1>
        <p className="muted">Advisory needs a sign-in and a connection to the server.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="adv-title">
      <div className="row">
        <h1 id="adv-title">Advisory</h1>
        <button type="button" className="primary" disabled={busy} onClick={() => void runChecks()}>
          Run checks now
        </button>
      </div>
      <p className="muted small">
        Suggestions only. Nothing changes until you accept one, and nothing is sent to the car.
      </p>
      {status ? (
        <p className="muted small" data-testid="advisory-status">
          Model: {status.model_enabled ? `on (${status.model_id ?? 'not set'})` : 'off'}. Calls this
          month: {status.calls_this_month} of {status.monthly_limit}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {lastRun ? (
        <div className="notice info" role="status" data-testid="advisory-run">
          <p>
            Checked: {lastRun.created.length} new, {lastRun.unchanged} already known.
          </p>
          {lastRun.skipped.map((s) => (
            <p key={s.condition}>Skipped “{CONDITION_LABELS[s.condition]}”: not enough data yet.</p>
          ))}
        </div>
      ) : null}
      {items === null ? (
        <p role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">No open suggestions.</p>
      ) : (
        <ul className="list" aria-label="Suggestions">
          {items.map((p) => (
            <li key={p.id} data-testid="proposal">
              <h2>{CONDITION_LABELS[p.condition]}</h2>
              <dl className="small">
                {Object.entries(p.inputs).map(([k, v]) => (
                  <div key={k}>
                    <dt>{INPUT_LABELS[k] ?? k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
              {p.explanation ? <p>{p.explanation}</p> : null}
              <p className="muted small">{EXPLANATION_NOTES[p.explanation_status]}</p>
              <p className="muted small">
                Rule version {p.provenance.rule_version}
                {p.provenance.model_id ? `, model ${p.provenance.model_id}` : ''}.
              </p>
              <div className="actions">
                {p.suggestion ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      accept(p);
                    }}
                  >
                    Accept: add reminder
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => void dismiss(p)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
