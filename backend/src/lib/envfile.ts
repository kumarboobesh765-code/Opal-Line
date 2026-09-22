import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Must match the file dotenv actually loads. In the packaged desktop app the
// backend runs from Program Files (read-only) while the writable .env lives in
// %APPDATA%\Opal Line Billing\data — Electron passes its path via
// DOTENV_CONFIG_PATH. Using cwd/.env here silently dropped every UI-saved
// config on restart (and crashed with EPERM on Program Files installs).
const ENV_PATH = process.env.DOTENV_CONFIG_PATH?.trim() || join(process.cwd(), '.env')

export function upsertEnvVar(key: string, value: string): void {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^\\s*${escaped}\\s*=`)
  let lines: string[] = []
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)
  }
  const newLine = `${key}=${value}`
  const index = lines.findIndex((line) => pattern.test(line))
  if (index >= 0) {
    lines[index] = newLine
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    lines.push(newLine)
  }
  writeFileSync(ENV_PATH, lines.join('\n').trimEnd() + '\n', { mode: 0o600 })
}