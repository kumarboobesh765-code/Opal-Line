#!/usr/bin/env node
/**
 * Sets a GitHub Actions repository secret via the REST API (libsodium sealed
 * box), for machines that don't have the gh CLI installed.
 *
 * Requires libsodium-wrappers once:  npm install --no-save libsodium-wrappers
 *
 * Usage:
 *   GH_TOKEN=<token with repo:write> node scripts/set-gh-secret.mjs \
 *     WIN_SIGNING_PFX_B64 dist-electron/code-signing.b64
 *
 * Get GH_TOKEN from the stored Git Credential Manager login without printing
 * it:
 *   GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill \
 *     | sed -n 's/^password=//p')
 */
import { readFileSync } from 'node:fs'

const REPO = process.env.GITHUB_REPO ?? 'kumarboobesh765-code/Opal-Line'
const [name, file] = process.argv.slice(2)

if (!name || !file) {
  console.error('usage: GH_TOKEN=... node scripts/set-gh-secret.mjs <SECRET_NAME> <file-with-value>')
  process.exit(2)
}
const token = process.env.GH_TOKEN?.trim()
if (!token) {
  console.error('GH_TOKEN is required (a GitHub token with repository secrets write access)')
  process.exit(2)
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'opal-line-tools',
}

const pubRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers })
if (!pubRes.ok) {
  console.error(`public-key fetch failed: HTTP ${pubRes.status} ${await pubRes.text()}`)
  process.exit(1)
}
const { key, key_id } = (await pubRes.json())

const sodium = (await import('libsodium-wrappers')).default
await sodium.ready
const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
const plaintext = readFileSync(file)
const sealed = sodium.crypto_box_seal(plaintext, publicKey)

const putRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
    key_id,
  }),
})
if (!putRes.ok) {
  console.error(`secret update failed: HTTP ${putRes.status} ${await putRes.text()}`)
  process.exit(1)
}
console.log(`Secret ${name} set on ${REPO} (${plaintext.length}-byte value)`)
