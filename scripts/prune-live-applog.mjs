// One-off: reclaim the live 5.5 GB app.log now instead of waiting for the
// next app launch. Uses the exact pruneLogIfTooBig logic from electron/.
// Safe while the app runs: logLine appends with 'a', so it lands at the new
// EOF after truncation.
import { statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { pruneLogIfTooBig, resetLogRotateStateForTests, LOG_KEEP_BYTES } = await import(
  pathToFileURL(join(repoRoot, 'electron', 'dist', 'logrotate.js')).href
)

const p = join(process.env.APPDATA, 'Opal Line Billing', 'logs', 'app.log')
const before = statSync(p).size
resetLogRotateStateForTests()
pruneLogIfTooBig(p, 0)
const after = statSync(p).size
console.log('before MB=', (before / 1048576).toFixed(1))
console.log('after MB=', (after / 1048576).toFixed(2), 'expected', LOG_KEEP_BYTES)
console.log('tail sample:', JSON.stringify(readFileSync(p, 'utf8').slice(-150)))
