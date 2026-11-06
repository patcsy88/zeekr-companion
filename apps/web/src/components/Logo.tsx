/** The app's own mark (a rounded Z), the same drawing as public/favicon.svg. Not the Zeekr logo. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="12" fill="#0f5e57" />
      <g strokeWidth="5.8" strokeLinecap="round" fill="none">
        <path d="M46 19.2L18 44.8" stroke="#8fe8d9" />
        <path d="M18 19.2h28M18 44.8h28" stroke="#fff" />
      </g>
    </svg>
  );
}
