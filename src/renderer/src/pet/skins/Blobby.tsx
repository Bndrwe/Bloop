import type { PetMood } from '@shared/types'
import type { PetSkinProps } from './types'

/**
 * "Blobby" — the default Bloop: a round creature with a sprout, drawn as black-and-white line art.
 * White paper body + black ink outline, so it reads on both light and dark wallpapers.
 * Pure inline SVG, flat fills only; animation hooks are the `pb-*` class names styled in pet.css.
 */

const INK = '#000'
const PAPER = '#fff'
const TONGUE = '#9a9a9a'
const SHADOW = '#808080'
const LINE = 3
const FINE = 1.8

function OpenEyes({ small = false }: { small?: boolean }): JSX.Element {
  const rx = small ? 6.8 : 7.6
  const ry = small ? 8.2 : 9.2
  return (
    <g className="pb-eyes">
      {[45, 75].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={68} rx={rx} ry={ry} fill={INK} />
          <circle cx={cx + 2.6} cy={64.2} r={3.1} fill="#fff" />
          <circle cx={cx - 2.4} cy={71.6} r={1.4} fill="#fff" opacity={0.9} />
        </g>
      ))}
    </g>
  )
}

function HappyEyes(): JSX.Element {
  return (
    <g className="pb-eyes-happy" fill="none" stroke={INK} strokeWidth={3.6} strokeLinecap="round">
      <path d="M38 70 Q45 59 52 70" />
      <path d="M68 70 Q75 59 82 70" />
    </g>
  )
}

function ClosedEyes(): JSX.Element {
  return (
    <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
      <path d="M38 68 Q45 74 52 68" />
      <path d="M68 68 Q75 74 82 68" />
    </g>
  )
}

function SadEyes(): JSX.Element {
  return (
    <g>
      {[45, 75].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={70} rx={6.8} ry={7.6} fill={INK} />
          <circle cx={cx + 1.8} cy={70.5} r={2.2} fill="#fff" />
        </g>
      ))}
      {/* droopy lids: lower on the outer side */}
      <path d="M35 58 L56 58 L56 66 Q46 63.5 35 69.5 Z" fill={PAPER} />
      <path d="M64 58 L85 58 L85 69.5 Q74 63.5 64 66 Z" fill={PAPER} />
      <g fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round">
        <path d="M36 69 Q46 63 55 66" />
        <path d="M65 66 Q74 63 84 69" />
      </g>
    </g>
  )
}

function WorriedBrows(): JSX.Element {
  return (
    <g className="pb-brows" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round">
      <path d="M37 57 Q44 55.5 51 52" />
      <path d="M69 52 Q76 55.5 83 57" />
    </g>
  )
}

/** Blush as three little ink hatch marks per cheek. */
function Blush(): JSX.Element {
  return (
    <g fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round">
      {[30, 85].map((x) => (
        <g key={x}>
          <path d={`M${x - 2} ${83} L${x + 1} ${77}`} />
          <path d={`M${x + 2} ${83} L${x + 5} ${77}`} />
          <path d={`M${x + 6} ${83} L${x + 9} ${77}`} />
        </g>
      ))}
    </g>
  )
}

function Mouth({ mood }: { mood: PetMood }): JSX.Element {
  switch (mood) {
    case 'happy':
    case 'wave':
      return (
        <g>
          <path d="M53 79 Q60 80 67 79 Q66 89 60 89 Q54 89 53 79 Z" fill={INK} />
          <path d="M55.6 85.4 Q60 82.2 64.4 85.4 Q62.6 88.6 60 88.6 Q57.4 88.6 55.6 85.4 Z" fill={TONGUE} />
        </g>
      )
    case 'celebrate':
      return (
        <g>
          <path d="M50 78 Q60 80 70 78 Q69 93 60 93 Q51 93 50 78 Z" fill={INK} />
          <path d="M53.5 87.5 Q60 83 66.5 87.5 Q64 92.4 60 92.4 Q56 92.4 53.5 87.5 Z" fill={TONGUE} />
        </g>
      )
    case 'worried':
      return (
        <path
          d="M52 84 Q54.7 80.5 57.3 84 Q60 87.5 62.7 84 Q65.3 80.5 68 84"
          fill="none"
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )
    case 'sad':
      return (
        <path d="M53 87 Q60 80.5 67 87" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      )
    case 'sleeping':
      return <ellipse cx={60} cy={84} rx={2.6} ry={3.1} fill={INK} />
    default:
      return (
        <path d="M54 80 Q60 86.5 66 80" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
      )
  }
}

function Star({ x, y, r, fill, className }: { x: number; y: number; r: number; fill: string; className?: string }): JSX.Element {
  // Stars are white with an ink edge so they read over any wallpaper; a black star is solid ink.
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.45
    pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`)
  }
  return (
    <polygon
      className={className}
      points={pts.join(' ')}
      fill={fill}
      stroke={INK}
      strokeWidth={1.4}
      strokeLinejoin="round"
      paintOrder="stroke"
    />
  )
}

function Confetti(): JSX.Element {
  // Alternating solid-ink and paper-with-ink-edge bits, so the burst reads on any background.
  const bits: Array<{ x: number; y: number; c: string; kind: 'rect' | 'dot' | 'star'; d: number }> = [
    { x: 14, y: 26, c: INK, kind: 'rect', d: 0 },
    { x: 28, y: 10, c: PAPER, kind: 'star', d: 0.2 },
    { x: 46, y: 6, c: INK, kind: 'dot', d: 0.45 },
    { x: 82, y: 6, c: PAPER, kind: 'rect', d: 0.1 },
    { x: 96, y: 16, c: PAPER, kind: 'star', d: 0.35 },
    { x: 108, y: 34, c: INK, kind: 'dot', d: 0.55 },
    { x: 8, y: 50, c: PAPER, kind: 'star', d: 0.6 },
    { x: 112, y: 58, c: INK, kind: 'rect', d: 0.25 }
  ]
  return (
    <g className="pb-confetti">
      {bits.map((b, i) => (
        <g key={i} className="pb-confetto" style={{ animationDelay: `${b.d}s` }}>
          {b.kind === 'rect' && (
            <rect
              x={b.x - 2.5}
              y={b.y - 1.5}
              width={7}
              height={4}
              rx={1.2}
              fill={b.c}
              stroke={INK}
              strokeWidth={1.3}
              transform={`rotate(${i * 37} ${b.x} ${b.y})`}
            />
          )}
          {b.kind === 'dot' && <circle cx={b.x} cy={b.y} r={3} fill={b.c} stroke={INK} strokeWidth={1.3} />}
          {b.kind === 'star' && <Star x={b.x} y={b.y} r={6.5} fill={b.c} />}
        </g>
      ))}
    </g>
  )
}

export function Blobby({ mood }: PetSkinProps): JSX.Element {
  const waving = mood === 'wave'

  let eyes: JSX.Element
  switch (mood) {
    case 'happy':
    case 'celebrate':
      eyes = <HappyEyes />
      break
    case 'sleeping':
      eyes = <ClosedEyes />
      break
    case 'sad':
      eyes = <SadEyes />
      break
    case 'worried':
      eyes = <OpenEyes small />
      break
    default:
      eyes = <OpenEyes />
  }

  return (
    <svg className="pb" viewBox="0 0 120 120" width="100%" height="100%" overflow="visible" aria-hidden="true">
      {/* flat grey ground shadow — no blur */}
      <ellipse className="pb-shadow" cx={60} cy={113} rx={30} ry={3.6} fill={SHADOW} opacity={0.45} />

      {mood === 'celebrate' && <Confetti />}

      <g className="pb-bob">
        {/* feet */}
        <ellipse cx={45} cy={107} rx={9} ry={5} fill={PAPER} stroke={INK} strokeWidth={LINE - 0.4} />
        <ellipse cx={75} cy={107} rx={9} ry={5} fill={PAPER} stroke={INK} strokeWidth={LINE - 0.4} />

        {/* arms */}
        <ellipse className="pb-arm-left" cx={17.5} cy={82} rx={6.5} ry={9} fill={PAPER} stroke={INK} strokeWidth={LINE - 0.4} transform="rotate(20 17.5 82)" />
        {waving ? (
          <g className="pb-arm-wave">
            <ellipse cx={107} cy={56} rx={7} ry={12} fill={PAPER} stroke={INK} strokeWidth={LINE - 0.4} transform="rotate(38 107 56)" />
          </g>
        ) : (
          <ellipse className="pb-arm-right" cx={102.5} cy={82} rx={6.5} ry={9} fill={PAPER} stroke={INK} strokeWidth={LINE - 0.4} transform="rotate(-20 102.5 82)" />
        )}

        {/* body */}
        <path
          d="M60 30 C89 30 105 52 105 77 C105 99 87 109 60 109 C33 109 15 99 15 77 C15 52 31 30 60 30 Z"
          fill={PAPER}
          stroke={INK}
          strokeWidth={LINE}
          strokeLinejoin="round"
        />
        {/* ink gloss: a short broken arc on the upper left, like a pen-drawn highlight */}
        <path d="M30 56 Q33 45 42 39" fill="none" stroke={INK} strokeWidth={FINE} strokeLinecap="round" />
        <path d="M27.5 63 L28.2 60.6" fill="none" stroke={INK} strokeWidth={FINE} strokeLinecap="round" />

        {/* sprout: ink stem, paper leaves with a centre vein */}
        <g className="pb-sprout">
          <path d="M60 31 C60 25 61 20 63 16" fill="none" stroke={INK} strokeWidth={LINE} strokeLinecap="round" />
          <path d="M62 18 C55 9 46 10 43 15 C49 22 57 22 62 18 Z" fill={PAPER} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
          <path d="M63 17 C68 7 79 7 82 12 C77 20 68 21 63 17 Z" fill={PAPER} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
          <g fill="none" stroke={INK} strokeWidth={1.2} strokeLinecap="round">
            <path d="M59 17 Q52 15 47 15" />
            <path d="M66 15 Q72 12 78 12" />
          </g>
        </g>

        {/* face */}
        <g className="pb-face">
          <Blush />
          {eyes}
          {(mood === 'worried' || mood === 'sad') && <WorriedBrows />}
          <Mouth mood={mood} />
        </g>

        {mood === 'worried' && (
          <g className="pb-sweat">
            <path d="M93 40 C97 46 98.5 50 93 52.5 C87.5 50 89 46 93 40 Z" fill={PAPER} stroke={INK} strokeWidth={FINE} strokeLinejoin="round" />
            <path d="M91.2 48.6 Q91 46.6 92.2 45.2" fill="none" stroke={INK} strokeWidth={1} strokeLinecap="round" />
          </g>
        )}
        {mood === 'sad' && (
          <path className="pb-tear" d="M38 77 C41 82 42 85 38 87 C34 85 35 82 38 77 Z" fill={PAPER} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        )}
        {mood === 'happy' && (
          <g>
            <Star className="pb-sparkle" x={98} y={36} r={6} fill={PAPER} />
            <Star className="pb-sparkle pb-sparkle--2" x={20} y={50} r={4.5} fill={INK} />
          </g>
        )}
      </g>

      {mood === 'sleeping' && (
        <g
          className="pb-zzz"
          fill={PAPER}
          stroke={INK}
          strokeWidth={2.6}
          strokeLinejoin="round"
          paintOrder="stroke"
          fontFamily="'Geist Sans', system-ui, sans-serif"
          fontWeight={600}
        >
          <text className="pb-z pb-z--1" x={80} y={30} fontSize={17}>
            z
          </text>
          <text className="pb-z pb-z--2" x={93} y={14} fontSize={12}>
            z
          </text>
        </g>
      )}
    </svg>
  )
}
