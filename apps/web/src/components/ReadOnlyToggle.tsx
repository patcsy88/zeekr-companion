/** A read-only on/off indicator. It is not a control: nothing here can send anything to the car. */
export function ReadOnlyToggle({ label, value }: { label: string; value: boolean | null }) {
  const state = value === null ? 'unknown' : value ? 'on' : 'off';
  const text = value === null ? 'no reading' : value ? 'On' : 'Off';
  return (
    <span
      className={`ro-toggle ro-toggle-${state}`}
      role="switch"
      tabIndex={0}
      aria-checked={value === null ? undefined : value}
      aria-readonly="true"
      aria-label={`${label}: ${value === null ? 'no reading' : value ? 'on' : 'off'}`}
      data-testid={`toggle-${state}`}
    >
      <span className="ro-track" aria-hidden="true">
        <span className="ro-knob" />
      </span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
