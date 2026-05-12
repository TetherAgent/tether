import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type LogLevel = 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

const APP = 'gateway'
const LOG_DIR = path.join(os.homedir(), '.tether', 'logs')
const KEEP_DAYS = 7

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(LOG_DIR, `${APP}.${date}.json`)
}

function write(level: LogLevel, module: string, msg: string, fields?: LogFields): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, app: APP, module, msg, ...fields })
  try {
    appendFileSync(logFilePath(), entry + '\n')
  } catch {}
  if (level === 'error') {
    process.stderr.write(entry + '\n')
  }
}

export function cleanOldLogs(): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    for (const file of readdirSync(LOG_DIR)) {
      if (!file.startsWith(`${APP}.`) || !file.endsWith('.json')) continue
      const dateStr = file.slice(APP.length + 1, -5)
      if (new Date(dateStr).getTime() < cutoff) {
        rmSync(path.join(LOG_DIR, file), { force: true })
      }
    }
  } catch {}
}

export function initLogger(): void {
  mkdirSync(LOG_DIR, { recursive: true })
  cleanOldLogs()
}

export const logger = {
  info: (module: string, msg: string, fields?: LogFields) => write('info', module, msg, fields),
  warn: (module: string, msg: string, fields?: LogFields) => write('warn', module, msg, fields),
  error: (module: string, msg: string, fields?: LogFields) => write('error', module, msg, fields),
}
