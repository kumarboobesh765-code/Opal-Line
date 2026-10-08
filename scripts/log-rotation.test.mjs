// Proves electron/logrotate.ts actually bounds app.log.
//
//   1. A file under the cap is never touched (no false truncation).
//   2. An oversized file is cut down to LOG_KEEP_BYTES, keeping the NEWEST
//      bytes (the System Status log viewer needs recent history).
//   3. Size is only measured after ~LOG_MAX_BYTES of new appends, but the
//      first call always measures — so a pre-existing 5.5 GB legacy file is
//      reclaimed on the very first log line after upgrade.
//   4. Bytes written after a prune keep appending normally.
//
// The module is TypeScript, so we compile electron/ with tsc first (the same
// command scripts/build-desktop.js runs) and import the emitted JS.
//
// Run: node --test scripts/log-rotation.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, statSync, appendFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

execSync('npx tsc', { cwd: join(repoRoot, 'electron'), stdio: 'pipe', timeout: 120000 })
const { pruneLogIfTooBig, LOG_MAX_BYTES, LOG_KEEP_BYTES, resetLogRotateStateForTests } =
  await import(pathToFileURL(join(repoRoot, 'electron', 'dist', 'logrotate.js')).href)

const dir = mkdtempSync(join(tmpdir(), 'opal-logrot-'))

test('under-cap file is not touched', () => {
  const f = join(dir, 'small.log')
  const content = 'x'.repeat(LOG_MAX_BYTES - 1024)
  writeFileSync(f, content)
  resetLogRotateStateForTests()
  pruneLogIfTooBig(f, 0)
  assert.equal(statSync(f).size, content.length, 'file must be byte-identical when under cap')
  rmSync(f, { force: true })
})

test('oversized file is pruned to LOG_KEEP_BYTES, keeping the newest bytes', () => {
  const f = join(dir, 'big.log')
  const head = 'HEAD'.repeat(1000) // old history that must be discarded
  const tail = 'TAIL-MARKER'.repeat(50) // most recent history that must survive
  writeFileSync(f, head + 'M'.repeat(LOG_MAX_BYTES) + tail)
  const originalSize = statSync(f).size
  assert.ok(originalSize > LOG_MAX_BYTES)

  resetLogRotateStateForTests()
  pruneLogIfTooBig(f, 0)

  const size = statSync(f).size
  assert.equal(size, LOG_KEEP_BYTES, `expected prune to ${LOG_KEEP_BYTES} bytes, got ${size}`)
  const kept = readFileSync(f, 'utf8')
  assert.ok(kept.includes('TAIL-MARKER'), 'newest bytes must be kept for the log viewer')
  assert.ok(!kept.startsWith('HEAD'), 'oldest bytes must be discarded')
  assert.ok(kept.endsWith(tail), 'the very newest bytes must be the end of the file')
  rmSync(f, { force: true })
})

test('size is only checked after LOG_MAX_BYTES of new appends, but first call always checks', () => {
  const f = join(dir, 'throttle.log')
  // Legacy oversized file — simulates the 5.5 GB app.log in the field.
  writeFileSync(f, 'L'.repeat(LOG_MAX_BYTES + LOG_KEEP_BYTES))
  resetLogRotateStateForTests()

  // First call with zero added bytes must still measure and reclaim.
  pruneLogIfTooBig(f, 0)
  assert.equal(statSync(f).size, LOG_KEEP_BYTES, 'legacy oversized file reclaimed on first call')

  // Grow it back past the cap, then add fewer than LOG_MAX_BYTES: no check yet.
  writeFileSync(f, 'G'.repeat(LOG_MAX_BYTES + 4096))
  pruneLogIfTooBig(f, 1) // 1 byte — well under the check interval
  assert.equal(statSync(f).size, LOG_MAX_BYTES + 4096, 'no prune before the check interval elapses')

  // Crossing the interval triggers the prune.
  pruneLogIfTooBig(f, LOG_MAX_BYTES)
  assert.equal(statSync(f).size, LOG_KEEP_BYTES, 'prune runs once the check interval is crossed')
  rmSync(f, { force: true })
})

test('appends continue normally after a prune', () => {
  const f = join(dir, 'append.log')
  writeFileSync(f, 'A'.repeat(LOG_MAX_BYTES + 100))
  resetLogRotateStateForTests()
  pruneLogIfTooBig(f, 0)
  assert.equal(statSync(f).size, LOG_KEEP_BYTES)
  appendFileSync(f, 'NEW-LINE\n')
  assert.equal(statSync(f).size, LOG_KEEP_BYTES + 'NEW-LINE\n'.length)
  assert.ok(readFileSync(f, 'utf8').endsWith('NEW-LINE\n'))
  rmSync(f, { force: true })
})

test('missing file does not throw', () => {
  resetLogRotateStateForTests()
  assert.doesNotThrow(() => pruneLogIfTooBig(join(dir, 'does-not-exist.log'), 0))
})

after(() => rmSync(dir, { recursive: true, force: true }))
