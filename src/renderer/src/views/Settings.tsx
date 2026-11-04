import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Reminder, Settings } from '@shared/types'
import { Pet } from '../pet/Pet'
import { DAY_LETTERS, DAY_SHORT, errMsg } from '../lib/format'
import './settings.css'

type ListKey = 'focusApps' | 'distractApps' | 'focusDomains' | 'distractDomains'

function ChipList({
  title,
  hint,
  items,
  kind,
  placeholder,
  normalize,
  onChange
}: {
  title: string
  hint: string
  items: string[]
  kind: 'focus' | 'distract'
  placeholder: string
  normalize?: (v: string) => string
  onChange: (next: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const raw = draft.trim()
    const v = normalize ? normalize(raw) : raw
    if (!v) return
    if (!items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v])
    setDraft('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && draft === '' && items.length > 0) {
      onChange(items.slice(0, -1))
    }
  }

  return (
    <div className="chiplist">
      <div className="chiplist-head">
        <h4>{title}</h4>
        <span className="muted">{hint}</span>
      </div>
      <div className="chiplist-box">
        {items.map((item) => (
          <span key={item} className={`chip chip--${kind}`}>
            {item}
            <button aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((i) => i !== item))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
        />
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min = 1,
  max = 100000,
  unit,
  hint,
  onChange
}: {
  label: string
  value: number
  min?: number
  max?: number
  unit: string
  hint?: string
  onChange: (n: number) => void
}): JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (raw: string): void => {
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max && n !== value) onChange(Math.round(n))
  }
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          min={min}
          max={max}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value)
          }}
          onBlur={() => setText(String(value))}
        />
        <span className="muted">{unit}</span>
      </span>
      {hint && <span className="field-hint muted">{hint}</span>}
    </label>
  )
}

function asMin(sec: number): string {
  if (sec < 60) return `${sec} sec`
  const m = sec / 60
  return `≈ ${Number.isInteger(m) ? m : m.toFixed(1)} min`
}

function normalizeDomain(v: string): string {
  let s = v.trim().toLowerCase()
  s = s.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  return s
}

function ReminderRow({
  r,
  onChange,
  onDelete
}: {
  r: Reminder
  onChange: (r: Reminder) => void
  onDelete: () => void
}): JSX.Element {
  const toggleDay = (d: number): void => {
    const days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort((a, b) => a - b)
    onChange({ ...r, days })
  }
  return (
    <div className={`reminder${r.enabled ? '' : ' reminder--off'}`}>
      <label className="toggle" title={r.enabled ? 'Enabled' : 'Disabled'}>
        <input type="checkbox" checked={r.enabled} onChange={(e) => onChange({ ...r, enabled: e.target.checked })} />
        <span />
      </label>
      <input
        className="reminder-time"
        type="time"
        value={r.time}
        onChange={(e) => e.target.value && onChange({ ...r, time: e.target.value })}
      />
      <div className="days" role="group" aria-label="Days">
        {DAY_LETTERS.map((l, d) => (
          <button
            key={d}
            className={`day${r.days.includes(d) ? ' day--on' : ''}`}
            title={DAY_SHORT[d]}
            aria-pressed={r.days.includes(d)}
            onClick={() => toggleDay(d)}
          >
            {l}
          </button>
        ))}
      </div>
      <input
        className="reminder-label"
        value={r.label}
        placeholder="Study time!"
        onChange={(e) => onChange({ ...r, label: e.target.value })}
      />
      <button className="icon-del" aria-label="Delete reminder" onClick={onDelete}>
        ×
      </button>
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [deadlineNote, setDeadlineNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const pending = useRef<Partial<Settings>>({})
  const timer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((text: string) => {
    setToast({ text, id: Date.now() })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }, [])

  const load = useCallback(() => {
    window.studyPet
      .getSettings()
      .then((s) => {
        setSettings(s)
        setLoadError(null)
      })
      .catch((e) => setLoadError(errMsg(e)))
  }, [])

  useEffect(load, [load])

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const patch = pending.current
    if (Object.keys(patch).length === 0) return
    pending.current = {}
    try {
      await window.studyPet.saveSettings(patch)
      showToast('Saved ✓')
    } catch (e) {
      showToast(`Couldn’t save: ${errMsg(e)}`)
    }
  }, [showToast])

  useEffect(() => {
    const onUnload = (): void => void flush()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      void flush()
    }
  }, [flush])

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => (s ? { ...s, ...patch } : s))
      pending.current = { ...pending.current, ...patch }
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), 600)
    },
    [flush]
  )

  if (!settings) {
    return (
      <div className="settings settings--loading">
        <Pet mood={loadError ? 'sad' : 'sleeping'} size={90} />
        <p className="muted">{loadError ? `Couldn’t load settings: ${loadError}` : 'Loading…'}</p>
      </div>
    )
  }

  const setList = (key: ListKey) => (next: string[]) => update({ [key]: next } as Partial<Settings>)

  const setReminder = (r: Reminder): void =>
    update({ reminders: settings.reminders.map((x) => (x.id === r.id ? r : x)) })

  const addReminder = (): void =>
    update({
      reminders: [
        ...settings.reminders,
        { id: crypto.randomUUID(), days: [1, 2, 3, 4, 5], time: '18:00', label: 'Study time!', enabled: true }
      ]
    })

  const refreshDeadlines = async (): Promise<void> => {
    setRefreshing(true)
    setDeadlineNote(null)
    try {
      await flush()
      const res = await window.studyPet.refreshDeadlines()
      setDeadlineNote(
        res.ok ? `Found ${res.value.length} upcoming item${res.value.length === 1 ? '' : 's'}.` : `Error: ${res.error}`
      )
    } catch (e) {
      setDeadlineNote(`Error: ${errMsg(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!confirm('Reset all Study Pet data? This deletes your session history and restores default settings.')) return
    try {
      if (timer.current) window.clearTimeout(timer.current)
      pending.current = {}
      await window.studyPet.resetData()
      load()
      showToast('Data reset')
    } catch (e) {
      showToast(`Reset failed: ${errMsg(e)}`)
    }
  }

  return (
    <div className="settings">
      <header className="settings-head">
        <Pet mood="happy" size={52} />
        <div>
          <h1>Settings</h1>
          <p className="muted">Changes save automatically.</p>
        </div>
      </header>

      <section className="card">
        <h2>Apps</h2>
        <div className="grid2">
          <ChipList
            title="Focus apps"
            hint="count as studying"
            kind="focus"
            placeholder="e.g. Notion — press Enter"
            items={settings.focusApps}
            onChange={setList('focusApps')}
          />
          <ChipList
            title="Distracting apps"
            hint="make the pet worried"
            kind="distract"
            placeholder="e.g. Discord — press Enter"
            items={settings.distractApps}
            onChange={setList('distractApps')}
          />
        </div>
      </section>

      <section className="card">
        <h2>Websites</h2>
        <div className="grid2">
          <ChipList
            title="Focus sites"
            hint="domains"
            kind="focus"
            placeholder="e.g. docs.google.com"
            normalize={normalizeDomain}
            items={settings.focusDomains}
            onChange={setList('focusDomains')}
          />
          <ChipList
            title="Distracting sites"
            hint="domains"
            kind="distract"
            placeholder="e.g. youtube.com"
            normalize={normalizeDomain}
            items={settings.distractDomains}
            onChange={setList('distractDomains')}
          />
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Nudges</h2>
          <NumberField
            label="Pet speaks up after"
            unit="sec"
            hint={asMin(settings.nudgeAfterSec)}
            value={settings.nudgeAfterSec}
            onChange={(n) => update({ nudgeAfterSec: n })}
          />
          <NumberField
            label="Notification after"
            unit="sec"
            hint={asMin(settings.notifyAfterSec)}
            value={settings.notifyAfterSec}
            onChange={(n) => update({ notifyAfterSec: n })}
          />
          <NumberField
            label="Quiet time between nudges"
            unit="sec"
            hint={asMin(settings.nudgeCooldownSec)}
            value={settings.nudgeCooldownSec}
            onChange={(n) => update({ nudgeCooldownSec: n })}
          />
        </section>

        <section className="card">
          <h2>Pomodoro</h2>
          <NumberField
            label="Focus length"
            unit="min"
            max={240}
            value={settings.focusMinutes}
            onChange={(n) => update({ focusMinutes: n })}
          />
          <NumberField
            label="Break length"
            unit="min"
            max={120}
            value={settings.breakMinutes}
            onChange={(n) => update({ breakMinutes: n })}
          />
          <label className="row-toggle">
            <span>Launch at login</span>
            <span className="toggle">
              <input
                type="checkbox"
                checked={settings.launchAtLogin}
                onChange={(e) => update({ launchAtLogin: e.target.checked })}
              />
              <span />
            </span>
          </label>
        </section>
      </div>

      <section className="card">
        <div className="section-head">
          <h2>Study reminders</h2>
          <button className="btn btn--small btn--primary" onClick={addReminder}>
            + Add reminder
          </button>
        </div>
        {settings.reminders.length === 0 ? (
          <p className="muted">No reminders yet. Your pet will wave at you at the times you pick.</p>
        ) : (
          <div className="reminders">
            {settings.reminders.map((r) => (
              <ReminderRow
                key={r.id}
                r={r}
                onChange={setReminder}
                onDelete={() => update({ reminders: settings.reminders.filter((x) => x.id !== r.id) })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Deadlines</h2>
        <label className="field field--wide">
          <span className="field-label">Brightspace iCal URL</span>
          <input
            className="text-input"
            type="url"
            value={settings.icalUrl}
            placeholder="https://…/calendar/feed/….ics"
            onChange={(e) => update({ icalUrl: e.target.value.trim() })}
          />
        </label>
        <div className="row">
          <button className="btn btn--small" disabled={refreshing} onClick={() => void refreshDeadlines()}>
            {refreshing ? 'Refreshing…' : 'Refresh deadlines'}
          </button>
          {deadlineNote && <span className="muted">{deadlineNote}</span>}
        </div>
      </section>

      <section className="card danger-zone">
        <div>
          <h2>Reset data</h2>
          <p className="muted">Delete session history and restore default settings.</p>
        </div>
        <button className="btn btn--danger" onClick={() => void reset()}>
          Reset…
        </button>
      </section>

      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
