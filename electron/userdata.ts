// Electron derives its default userData folder from package.json's `name`,
// while the app keeps its real data (database, logs, backups) in
// `%APPDATA%\<productName>` — so every fresh install ended up with TWO folders:
// "Opal Line Billing" next to "opal-line-project" holding cookies/caches/
// localStorage. Pin userData to APP_DATA before the app is ready and migrate
// whatever state the default folder already holds, so upgraded installs keep
// their login session and caches instead of starting blank.
//
// Kept free of `electron` imports so scripts/userdata-consolidation.test.mjs
// can exercise the real logic without booting Chromium.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Moves every entry from Electron's default userData folder into appDataDir
 * (same volume, so plain renames) and removes the old folder once it is empty.
 *
 * - On a name collision the copy already in appDataDir WINS and the source is
 *   left behind — real app data (pgdata, logs, .pg-password) must never be
 *   overwritten by a browser cache file.
 * - Never throws: profile migration must not prevent app startup.
 *
 * Returns true when the default folder existed and was consolidated.
 */
export function consolidateUserData(defaultDir: string, appDataDir: string): boolean {
  if (!defaultDir || !appDataDir || defaultDir === appDataDir) return false
  try {
    if (!existsSync(defaultDir)) return false
    mkdirSync(appDataDir, { recursive: true })
    for (const entry of readdirSync(defaultDir)) {
      const from = join(defaultDir, entry)
      const to = join(appDataDir, entry)
      if (existsSync(to)) continue
      try {
        renameSync(from, to)
      } catch {
        // File busy or mid-write — leave it behind rather than fail startup.
      }
    }
    if (readdirSync(defaultDir).length === 0) {
      rmSync(defaultDir, { recursive: true, force: true })
    }
    return true
  } catch {
    return false
  }
}
