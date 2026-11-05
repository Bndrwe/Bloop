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
  | 'download'
  | 'folder'
  | 'eye'
  | 'eye-off'

const PATHS: Record<IconName, JSX.Element> = {
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  // Settings cog: 8 square-ish teeth (outer r 6.9, root r 5.1) around a centre hole. A slightly
  // lighter stroke keeps the gaps between teeth open at 13-16 px.
  gear: (
    <g strokeWidth={1.4}>
      <path d="M6.77 3.05L6.92 1.18A6.9 6.9 0 0 1 9.08 1.18L9.23 3.05A5.1 5.1 0 0 1 10.63 3.63L12.06 2.42A6.9 6.9 0 0 1 13.58 3.94L12.37 5.37A5.1 5.1 0 0 1 12.95 6.77L14.82 6.92A6.9 6.9 0 0 1 14.82 9.08L12.95 9.23A5.1 5.1 0 0 1 12.37 10.63L13.58 12.06A6.9 6.9 0 0 1 12.06 13.58L10.63 12.37A5.1 5.1 0 0 1 9.23 12.95L9.08 14.82A6.9 6.9 0 0 1 6.92 14.82L6.77 12.95A5.1 5.1 0 0 1 5.37 12.37L3.94 13.58A6.9 6.9 0 0 1 2.42 12.06L3.63 10.63A5.1 5.1 0 0 1 3.05 9.23L1.18 9.08A6.9 6.9 0 0 1 1.18 6.92L3.05 6.77A5.1 5.1 0 0 1 3.63 5.37L2.42 3.94A6.9 6.9 0 0 1 3.94 2.42L5.37 3.63A5.1 5.1 0 0 1 6.77 3.05Z" />
      <circle cx="8" cy="8" r="2" />
    </g>
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
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  download: <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 13.2h10" />,
  folder: <path d="M2 4.6c0-.7.5-1.2 1.2-1.2h3l1.4 1.6h5.2c.7 0 1.2.5 1.2 1.2v5.6c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2z" />,
  // eye / eye-off: lucide "eye" and "eye-off" (ISC licence, lucide.dev), drawn on lucide's 24 px
  // grid and scaled to 16 px; stroke 2.4 there = 1.6 here, like the rest of the set.
  eye: (
    <g transform="scale(0.6667)" strokeWidth={2.4}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  'eye-off': (
    <g transform="scale(0.6667)" strokeWidth={2.4}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="M2 2l20 20" />
    </g>
  )
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
