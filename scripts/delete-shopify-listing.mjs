// One-off cleanup: deletes a single test listing ("Verify-Push-…") from the
// Shopify store using the dev backend's configured credentials.
// Usage: npx tsx scripts/delete-shopify-listing.mjs <shopifyNumericId>
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const backendDir = fileURLToPath(new URL('../backend', import.meta.url))

const id = process.argv[2]
if (!id) { console.error('usage: npx tsx scripts/delete-shopify-listing.mjs <shopifyNumericId>'); process.exit(1) }

// Pull store + token from the dev backend's live config (tsx resolves TS paths)
const probe = execSync(
  `npx tsx -e "import { config } from './src/config'; console.log(JSON.stringify({ store: config.shop, token: config.accessToken }))"`,
  { cwd: backendDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env }, shell: true },
).toString()
const jsonLine = probe.split('\n').find((l) => l.trim().startsWith('{'))
if (!jsonLine) { console.error('could not read config from dev backend; output was:\n' + probe.slice(0, 500)); process.exit(1) }
const { store, token } = JSON.parse(jsonLine)
if (!store || !token) { console.error('shopify not configured in dev env'); process.exit(1) }

const host = String(store).replace(/^https?:\/\//, '').replace(/\/.*$/, '')
const apiVersion = '2024-07'
const res = await fetch(`https://${host}/admin/api/${apiVersion}/products/${id}.json`, {
  method: 'DELETE',
  headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
}).catch((e) => { console.error('network error:', e.message); process.exit(1) })
console.log(`DELETE products/${id}: HTTP ${res.status} ${res.status === 200 || res.status === 204 ? '(deleted)' : await res.text().then(t => t.slice(0, 200))}`)
process.exit(res.ok ? 0 : 1)
