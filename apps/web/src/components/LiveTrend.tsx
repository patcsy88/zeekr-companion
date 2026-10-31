import { splitAtGaps, type Point } from '../lib/liveVehicle';

const W = 320;
const H = 90;
const PAD = 6;

/** A small line chart. Runs separated by a gap are drawn apart: no line crosses a gap. */
export function LiveTrend({
  title,
  points,
  intervalMinutes,
  fixed,
  unit,
}: {
  title: string;
  points: Point[];
  intervalMinutes: number;
  fixed?: [number, number];
  unit: string;
}) {
  if (points.length === 0) {
    return <p className="muted small">{title}: no readings.</p>;
  }
  const runs = splitAtGaps(points, intervalMinutes);
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const [lo, hi] = fixed ?? [Math.min(...vs), Math.max(...vs)];
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD));
  const y = (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD));
  const first = points.reduce((a, b) => (b.t < a.t ? b : a));
  const last = points.reduce((a, b) => (b.t > a.t ? b : a));
  const label = `${title}: from ${first.v}${unit} to ${last.v}${unit}, ${points.length} readings in ${runs.length} ${runs.length === 1 ? 'run' : 'runs'} (gaps are not joined).`;
  return (
    <figure className="trend" data-testid="live-trend">
      <figcaption className="small">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} width="100%">
        {runs.map((run, n) =>
          run.length === 1 ? (
            <circle key={n} cx={x(run[0]?.t ?? 0)} cy={y(run[0]?.v ?? 0)} r="2.5" />
          ) : (
            <polyline
              key={n}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              points={run.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
            />
          ),
        )}
      </svg>
    </figure>
  );
}
