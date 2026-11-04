import { useId } from 'react'
import type { PetMood } from '@shared/types'
import type { PetSkinProps } from './types'

/**
 * "Blobby" — the default Study Pet: an original round mint creature with a sprout.
 * Pure inline SVG; animation hooks are the `pb-*` class names styled in pet.css.
 */

const INK = '#2b2d42'
const BODY_LIGHT = '#d9f6e6'
const BODY = '#a8e6c4'
const BODY_DARK = '#7ccaa2'
const OUTLINE = '#5fae88'
const LEAF = '#7fcf8e'
const LEAF_DARK = '#4f9f63'
const BLUSH = '#ff9fb2'
const WATER = '#9fd8ff'

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

function SadEyes({ bodyFill }: { bodyFill: string }): JSX.Element {
  return (
    <g>
      {[45, 75].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={70} rx={6.8} ry={7.6} fill={INK} />
          <circle cx={cx + 1.8} cy={70.5} r={2.2} fill="#fff" />
        </g>
      ))}
      {/* droopy lids: lower on the outer side */}
      <path d="M35 58 L56 58 L56 66 Q46 63.5 35 69.5 Z" fill={bodyFill} />
      <path d="M64 58 L85 58 L85 69.5 Q74 63.5 64 66 Z" fill={bodyFill} />
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

function Blush(): JSX.Element {
  return (
    <g fill={BLUSH} opacity={0.6}>
      <ellipse cx={32.5} cy={80} rx={7} ry={4.2} />
      <ellipse cx={87.5} cy={80} rx={7} ry={4.2} />
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
          <path d="M55.6 85.4 Q60 82.2 64.4 85.4 Q62.6 88.6 60 88.6 Q57.4 88.6 55.6 85.4 Z" fill="#ff7a93" />
        </g>
      )
    case 'celebrate':
      return (
        <g>
          <path d="M50 78 Q60 80 70 78 Q69 93 60 93 Q51 93 50 78 Z" fill={INK} />
          <path d="M53.5 87.5 Q60 83 66.5 87.5 Q64 92.4 60 92.4 Q56 92.4 53.5 87.5 Z" fill="#ff7a93" />
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
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.45
    pts.push(`${(x + rr * Math.cos(a)).toFixed(2)},${(y + rr * Math.sin(a)).toFixed(2)}`)
  }
  return <polygon className={className} points={pts.join(' ')} fill={fill} />
}

function Confetti(): JSX.Element {
  const bits: Array<{ x: number; y: number; c: string; kind: 'rect' | 'dot' | 'star'; d: number }> = [
    { x: 14, y: 26, c: '#ffb3c7', kind: 'rect', d: 0 },
    { x: 28, y: 10, c: '#ffd36e', kind: 'star', d: 0.2 },
    { x: 46, y: 6, c: '#9fd8ff', kind: 'dot', d: 0.45 },
    { x: 82, y: 6, c: '#c6b3ff', kind: 'rect', d: 0.1 },
    { x: 96, y: 16, c: '#ffd36e', kind: 'star', d: 0.35 },
    { x: 108, y: 34, c: '#7fdcb0', kind: 'dot', d: 0.55 },
    { x: 8, y: 50, c: '#9fd8ff', kind: 'star', d: 0.6 },
    { x: 112, y: 58, c: '#ffb3c7', kind: 'rect', d: 0.25 }
  ]
  return (
    <g className="pb-confetti">
      {bits.map((b, i) => (
        <g key={i} className="pb-confetto" style={{ animationDelay: `${b.d}s` }}>
          {b.kind === 'rect' && (
            <rect x={b.x - 2.5} y={b.y - 1.5} width={5} height={3} rx={1} fill={b.c} transform={`rotate(${i * 37} ${b.x} ${b.y})`} />
          )}
          {b.kind === 'dot' && <circle cx={b.x} cy={b.y} r={2.4} fill={b.c} />}
          {b.kind === 'star' && <Star x={b.x} y={b.y} r={5} fill={b.c} />}
        </g>
      ))}
    </g>
  )
}

export function Blobby({ mood }: PetSkinProps): JSX.Element {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const bodyGrad = `pb-body-${uid}`
  const bodyFill = `url(#${bodyGrad})`
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
      eyes = <SadEyes bodyFill={bodyFill} />
      break
    case 'worried':
      eyes = <OpenEyes small />
      break
    default:
      eyes = <OpenEyes />
  }

  return (
    <svg className="pb" viewBox="0 0 120 120" width="100%" height="100%" overflow="visible" aria-hidden="true">
      <defs>
        <radialGradient id={bodyGrad} cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor={BODY_LIGHT} />
          <stop offset="55%" stopColor={BODY} />
          <stop offset="100%" stopColor={BODY_DARK} />
        </radialGradient>
      </defs>

      <ellipse className="pb-shadow" cx={60} cy={113} rx={30} ry={4} fill="#000" opacity={0.13} />

      {mood === 'celebrate' && <Confetti />}

      <g className="pb-bob">
        {/* feet */}
        <ellipse cx={45} cy={107} rx={9} ry={5} fill={BODY_DARK} stroke={OUTLINE} strokeWidth={1.6} />
        <ellipse cx={75} cy={107} rx={9} ry={5} fill={BODY_DARK} stroke={OUTLINE} strokeWidth={1.6} />

        {/* arms */}
        <ellipse className="pb-arm-left" cx={17.5} cy={82} rx={6.5} ry={9} fill={BODY} stroke={OUTLINE} strokeWidth={1.6} transform="rotate(20 17.5 82)" />
        {waving ? (
          <g className="pb-arm-wave">
            <ellipse cx={104} cy={60} rx={6.5} ry={10} fill={BODY} stroke={OUTLINE} strokeWidth={1.6} transform="rotate(30 104 60)" />
          </g>
        ) : (
          <ellipse className="pb-arm-right" cx={102.5} cy={82} rx={6.5} ry={9} fill={BODY} stroke={OUTLINE} strokeWidth={1.6} transform="rotate(-20 102.5 82)" />
        )}

        {/* body */}
        <path
          d="M60 30 C89 30 105 52 105 77 C105 99 87 109 60 109 C33 109 15 99 15 77 C15 52 31 30 60 30 Z"
          fill={bodyFill}
          stroke={OUTLINE}
          strokeWidth={2}
        />
        <ellipse cx={60} cy={95} rx={25} ry={11} fill="#fff" opacity={0.28} />
        <ellipse cx={40} cy={44} rx={9} ry={5} fill="#fff" opacity={0.45} transform="rotate(-25 40 44)" />

        {/* sprout */}
        <g className="pb-sprout">
          <path d="M60 31 C60 25 61 20 63 16" fill="none" stroke={LEAF_DARK} strokeWidth={3} strokeLinecap="round" />
          <path d="M62 18 C55 9 46 10 43 15 C49 22 57 22 62 18 Z" fill={LEAF} stroke={LEAF_DARK} strokeWidth={1.4} strokeLinejoin="round" />
          <path d="M63 17 C68 7 79 7 82 12 C77 20 68 21 63 17 Z" fill={LEAF} stroke={LEAF_DARK} strokeWidth={1.4} strokeLinejoin="round" />
        </g>

        {/* face */}
        <g className="pb-face">
          <Blush />
          {eyes}
          {(mood === 'worried' || mood === 'sad') && <WorriedBrows />}
          <Mouth mood={mood} />
        </g>

        {mood === 'worried' && (
          <path className="pb-sweat" d="M93 40 C97 46 98.5 50 93 52.5 C87.5 50 89 46 93 40 Z" fill={WATER} stroke="#6bb8e6" strokeWidth={1.2} />
        )}
        {mood === 'sad' && (
          <path className="pb-tear" d="M38 77 C41 82 42 85 38 87 C34 85 35 82 38 77 Z" fill={WATER} stroke="#6bb8e6" strokeWidth={1} />
        )}
        {mood === 'happy' && (
          <g>
            <Star className="pb-sparkle" x={98} y={36} r={5.5} fill="#ffd36e" />
            <Star className="pb-sparkle pb-sparkle--2" x={20} y={50} r={4} fill="#ffd36e" />
          </g>
        )}
      </g>

      {mood === 'sleeping' && (
        <g className="pb-zzz" fill="#8a8fb8" fontFamily="-apple-system, sans-serif" fontWeight={700}>
          <text className="pb-z pb-z--1" x={88} y={34} fontSize={14}>
            z
          </text>
          <text className="pb-z pb-z--2" x={99} y={20} fontSize={10}>
            z
          </text>
        </g>
      )}
    </svg>
  )
}
