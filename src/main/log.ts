// Small file logger for the main process. In an installed app nobody sees stdout, so every
// console.log / warn / error line (the `[bloop] ...` lines) is also appended to
// <app.getPath('logs')>/main.log. Users can reach it from the tray: "Open logs folder".
//   macOS:   ~/Library/Logs/<name>/main.log
//   Windows: %APPDATA%\<name>\logs\main.log
//   Linux:   ~/.config/<name>/logs/main.log
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { app } from 'electron'

const MAX_BYTES = 2 * 1024 * 1024

let file: string | null = null
let dir: string | null = null

export function logsDir(): string {
  return dir ?? app.getPath('logs')
}

export function logFile(): string | null {
  return file
}

function write(level: string, line: string): void {
  if (!file) return
  try {
    appendFileSync(file, `${new Date().toISOString()} ${level} ${line}\n`)
  } catch {
    /* disk full / read-only: never let logging take the app down */
  }
}

/** Mirror console output to the log file. Safe to call more than once. */
export function initFileLog(): void {
  if (file) return
  try {
    dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'main.log')
    // keep one previous file so the log never grows without bound
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
    } catch {
      /* no file yet */
    }
  } catch {
    file = null
    return
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      write(level === 'log' ? 'info' : level, format(...args))
      try {
        orig(...args)
      } catch {
        /* stdout closed (EPIPE) */
      }
    }
  }
  write('info', `---- Bloop ${app.getVersion()} (${process.platform}-${process.arch}, electron ${process.versions.electron}, packaged=${app.isPackaged}) pid=${process.pid}`)
}

/** "Reset all data": delete every file in the logs folder and start a fresh main.log. */
export function clearLogs(): void {
  const d = logsDir()
  try {
    for (const f of readdirSync(d)) rmSync(join(d, f), { recursive: true, force: true })
  } catch {
    /* folder missing */
  }
  write('info', '---- logs cleared (Reset all data)')
}

/** Write directly to the file (used by the crash handlers, which must not depend on console). */
export function logError(line: string): void {
  write('error', line)
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    /* ignore */
  }
}
