// Pure stats computation (no electron imports).
import type { DayStat, SessionRecord, Stats } from '@shared/types'

export function localDateKey(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayStat(date: string, sessions: SessionRecord[]): DayStat {
  const list = sessions.filter((s) => localDateKey(s.start) === date)
  let wSum = 0
  let wScore = 0
  let focusSec = 0
  for (const s of list) {
    focusSec += s.focusSec
    if (s.finalScore !== null && s.durationSec > 0) {
      wSum += s.durationSec
      wScore += s.durationSec * s.finalScore
    }
  }
  return {
    date,
    avgScore: wSum > 0 ? Math.round(wScore / wSum) : null,
    focusSec: Math.round(focusSec),
    sessions: list.length
  }
}

export function computeStats(sessions: SessionRecord[], now = Date.now()): Stats {
  const last7: DayStat[] = []
  const today = new Date(now)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12)
    last7.push(dayStat(localDateKey(d), sessions))
  }
  const t = last7[last7.length - 1]
  return { todayAvgScore: t.avgScore, todayFocusSec: t.focusSec, todaySessions: t.sessions, last7 }
}
