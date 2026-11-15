import { SwitchTrack } from './SwitchTrack';

/** A read-only on/off indicator. It is not a control: nothing here can send anything to the car. */
export function ReadOnlyToggle({ label, value }: { label: string; value: boolean | null }) {
  const state = value === null ? 'unknown' : value ? 'on' : 'off';
  const text = value === null ? 'no reading' : value ? 'On' : 'Off';
  return (
    <span
      className="pointer-events-none inline-flex items-center gap-2"
      role="switch"
      tabIndex={0}
      aria-checked={value === null ? undefined : value}
      aria-readonly="true"
      aria-label={`${label}: ${value === null ? 'no reading' : value ? 'on' : 'off'}`}
      data-testid={`toggle-${state}`}
    >
      <SwitchTrack state={state} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
