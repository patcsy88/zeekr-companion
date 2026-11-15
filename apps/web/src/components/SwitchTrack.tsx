import { cn } from '../lib/cn';

/** The button around a SwitchTrack, for the switches that send something (Sentry, Automatic Sentry). */
export const SWITCH_BUTTON =
  'inline-flex cursor-pointer items-center gap-2 bg-transparent py-1 disabled:cursor-progress disabled:opacity-70';

/** The track and knob of an on / off switch: near-black (light) or near-white (dark) when on, dashed when unknown. */
export function SwitchTrack({ state }: { state: 'on' | 'off' | 'unknown' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        state === 'on' && 'bg-primary',
        state === 'off' && 'bg-input',
        state === 'unknown' && 'border border-input border-dashed bg-transparent',
      )}
    >
      {state === 'unknown' ? null : (
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-[left] duration-200',
            state === 'on' ? 'left-4.5' : 'left-0.5',
          )}
        />
      )}
    </span>
  );
}
