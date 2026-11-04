/** Small authored icon set: 16px grid, 1.6 stroke, round caps, currentColor. */
export type IconName =
  | 'close'
  | 'gear'
  | 'check'
  | 'alert'
  | 'plus'
  | 'play'
  | 'pause'
  | 'stop'
  | 'skip'
  | 'refresh'
  | 'spark'
  | 'calendar'
  | 'bell'
  | 'trash'

const PATHS: Record<IconName, JSX.Element> = {
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
    </>
  ),
  check: <path d="M3.5 8.4l2.8 2.8 6.2-6.4" />,
  alert: (
    <>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.6v3M8 11.6v.1" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  play: <path d="M5 3.2v9.6L12.6 8z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" />,
  skip: <path d="M3.5 3.5L9 8l-5.5 4.5zM12 3.5v9" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.6v2.6h-2.6" />
    </>
  ),
  spark: <path d="M8 1.8l1.5 4.7 4.7 1.5-4.7 1.5L8 14.2l-1.5-4.7L1.8 8l4.7-1.5z" />,
  calendar: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="10" rx="2" />
      <path d="M2.4 6.6h11.2M5.4 2v2.6M10.6 2v2.6" />
    </>
  ),
  bell: (
    <>
      <path d="M4 11.4V7.6a4 4 0 0 1 8 0v3.8l1 1.2H3z" />
      <path d="M6.6 14h2.8" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
}

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }): JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  )
}
