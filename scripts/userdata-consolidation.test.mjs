// Proves electron/userdata.ts consolidates Electron's default userData folder
// into the single %APPDATA%\Opal Line Billing directory.
//
//   1. Cookies/caches move across and the stray folder is removed.
//   2. On a name collision the real app data already in APP_DATA wins and the
//      browser-cache copy is left behind (never overwrite pgdata/logs).
//   3. Same-dir / missing-dir / non-directory inputs are safe no-ops.
//
// The module is TypeScript, so compile electron/ with tsc first (the same
// command scripts/build-desktop.js runs) and import the emitted JS.
//
// Run: node --test scripts/userdata-consolidation.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

execSync('npx tsc', { cwd: join(repoRoot, 'electron'), stdio: 'pipe', timeout: 120000 })
const { consolidateUserData } = await import(
  pathToFileURL(join(repoRoot, 'electron', 'dist', 'userdata.js')).href
)

const root = mkdtempSync(join(tmpdir(), 'opal-userdata-'))

test('moves every entry across and removes the empty default folder', () => {
  const def = join(root, 'old-profile')
  const appData = join(root, 'Opal Line Billing')
  mkdirSync(join(def, 'Local Storage'), { recursive: true })
  writeFileSync(join(def, 'Cookies'), 'cookie-db')
  writeFileSync(join(def, 'Local Storage', 'leveldb'), 'state')
  mkdirSync(appData, { recursive: true })

  const moved = consolidateUserData(def, appData)

  assert.equal(moved, true, 'consolidation must report it ran')
  assert.equal(readFileSync(join(appData, 'Cookies'), 'utf8'), 'cookie-db')
  assert.equal(readFileSync(join(appData, 'Local Storage', 'leveldb'), 'utf8'), 'state')
  assert.equal(existsSync(def), false, 'stray default folder must be removed')
})

test('collision: real app data in APP_DATA wins, source copy is left behind', () => {
  const def = join(root, 'collide-profile')
  const appData = join(root, 'Opal Line Billing 2')
  mkdirSync(def, { recursive: true })
  mkdirSync(appData, { recursive: true })
  writeFileSync(join(def, 'pgdata'), 'browser-cache-impostor')
  writeFileSync(join(appData, 'pgdata'), 'REAL-DATABASE')
  writeFileSync(join(def, 'Cookies'), 'cookie-db')

  const moved = consolidateUserData(def, appData)

  assert.equal(moved, true)
  assert.equal(readFileSync(join(appData, 'pgdata'), 'utf8'), 'REAL-DATABASE', 'app data must never be overwritten')
  assert.equal(readFileSync(join(appData, 'Cookies'), 'utf8'), 'cookie-db', 'non-colliding entries still move')
  assert.equal(readFileSync(join(def, 'pgdata'), 'utf8'), 'browser-cache-impostor', 'colliding source is not deleted')
  assert.equal(existsSync(def), true, 'folder with leftover entries stays (nothing silently destroyed)')
})

test('no-op when defaultDir equals appDataDir or is empty', () => {
  const same = join(root, 'same')
  mkdirSync(same, { recursive: true })
  assert.equal(consolidateUserData(same, same), false, 'same path must not migrate onto itself')
  assert.ok(statSync(same).isDirectory())
  assert.equal(consolidateUserData('', join(root, 'x')), false, 'empty default path is a no-op')
})

test('missing default folder is a quiet false', () => {
  const appData = join(root, 'Opal Line Billing 3')
  assert.equal(consolidateUserData(join(root, 'never-existed'), appData), false)
  assert.equal(existsSync(appData), false, 'nothing to create when there is nothing to move')
})

test('default path pointing at a file never throws', () => {
  const file = join(root, 'not-a-dir')
  writeFileSync(file, 'x')
  assert.doesNotThrow(() => consolidateUserData(file, join(root, 'target')))
  assert.equal(existsSync(file), true, 'input left untouched on error')
})

test('creates the destination folder when it does not exist yet', () => {
  const def = join(root, 'fresh-profile')
  const appData = join(root, 'Opal Line Billing 4')
  mkdirSync(def, { recursive: true })
  writeFileSync(join(def, 'Cookies'), 'cookie-db')
  assert.equal(consolidateUserData(def, appData), true)
  assert.equal(readFileSync(join(appData, 'Cookies'), 'utf8'), 'cookie-db')
  assert.equal(existsSync(def), false)
})

after(() => rmSync(root, { recursive: true, force: true }))
