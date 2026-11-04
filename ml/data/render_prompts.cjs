// Renders the exact study-plan prompt by running buildPrompt() extracted from src/main/plan.ts.
// Usage: node render_prompts.cjs < scenarios.json > prompts.json
// Input : [{tz, now:[y,m,d,h,mi,s], deadlines:[{summary,isExam,at:[y,m,d,h,mi]}],
//           last7:[{date,sessions,focusSec,avgScore}], focusMinutes, breakMinutes}]
// Output: ["<prompt>", ...]
const fs = require('fs')
const path = require('path')
const esbuild = require(path.resolve(__dirname, '../../node_modules/esbuild'))

const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/plan.ts'), 'utf8')
const a = src.indexOf('const DAY_NAMES')
const bStart = src.indexOf('export function buildPrompt')
const bEnd = src.indexOf('\n}\n', bStart)
if (a < 0 || bStart < 0 || bEnd < 0) throw new Error('could not locate buildPrompt in plan.ts')
const snippet = src.slice(a, bEnd + 3).replace('export function buildPrompt', 'function buildPrompt')
// Types (Deadline, Stats, ...) are erased by esbuild; they are not imported here.
const js = esbuild.transformSync(snippet, { loader: 'ts', format: 'cjs' }).code
const buildPrompt = new Function(js + '\nreturn buildPrompt')()

const scenarios = JSON.parse(fs.readFileSync(0, 'utf8'))
const out = scenarios.map((s) => {
  process.env.TZ = s.tz
  const [y, mo, d, h, mi, se] = s.now
  const now = new Date(y, mo - 1, d, h, mi, se)
  const deadlines = s.deadlines.map((x, i) => ({
    uid: 'u' + i,
    summary: x.summary,
    isExam: x.isExam,
    start: new Date(x.at[0], x.at[1] - 1, x.at[2], x.at[3], x.at[4], 0).getTime()
  }))
  return buildPrompt(deadlines, { todayAvgScore: null, todayFocusSec: 0, todaySessions: 0, last7: s.last7 },
    { focusMinutes: s.focusMinutes, breakMinutes: s.breakMinutes }, now)
})
process.stdout.write(JSON.stringify(out))
