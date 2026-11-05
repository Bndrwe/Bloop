// A tiny, safe markdown subset for Bloop's chat replies: paragraphs, line breaks, bullet and
// numbered lists, ``` code blocks, `code`, **bold** and *italic*. Everything is rendered as React
// text nodes, so any HTML in a reply shows up as plain text: there is no raw HTML path.
import { Fragment, type ReactNode } from 'react'

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|(?<![A-Za-z0-9_])__[^_\n]+?__(?![A-Za-z0-9_])|\*[^*\s][^*\n]*?\*|(?<![A-Za-z0-9_])_[^_\s][^_\n]*?_(?![A-Za-z0-9_]))/g
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/

export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const k = `${keyBase}-${n++}`
    if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderText(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let n = 0
  const flushPara = (): void => {
    if (para.length) {
      const k = `${keyBase}-p${n++}`
      out.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>
      )
    }
    para = []
  }
  const flushList = (): void => {
    if (list) {
      const k = `${keyBase}-l${n++}`
      const items = list.items.map((it, i) => <li key={i}>{renderInline(it, `${k}-${i}`)}</li>)
      out.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    }
    list = null
  }
  for (const line of lines) {
    const b = BULLET.exec(line)
    const o = b ? null : NUMBERED.exec(line)
    if (b || o) {
      flushPara()
      const ordered = !!o
      if (list && list.ordered !== ordered) flushList()
      list ??= { ordered, items: [] }
      list.items.push(((b ?? o) as RegExpExecArray)[1] ?? '')
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return out
}

/** Bloop's reply as safe rich text. */
export function RichText({ text }: { text: string }): JSX.Element {
  const parts = text.split(/```[^\n`]*\n?/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i}>
            <code>{part.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          <Fragment key={i}>{renderText(part, `b${i}`)}</Fragment>
        )
      )}
    </>
  )
}
