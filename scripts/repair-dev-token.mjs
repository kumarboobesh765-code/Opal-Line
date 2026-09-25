// Repairs the DEV environment's Shopify token after a masked-value round-trip
// corrupted it in both backend/.env and the settings DB row.
// Real token source: the installed desktop app's .env (encrypted with the
// installed master key — that copy was taken before the corruption).
// All HTTP goes through node fetch (correct UTF-8), never shell curl.
import { readFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://localhost:47191'
const APP_DATA = process.env.APPDATA
  ? join(process.env.APPDATA, 'Opal Line Billing', 'data')
  : null
if (!APP_DATA) { console.error('no APPDATA'); process.exit(1) }

const ivLen = 16, tagLen = 16
function dec(keyHex, b64) {
  const key = Buffer.from(keyHex.trim(), 'hex')
  const buf = Buffer.from(b64, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, ivLen))
  d.setAuthTag(buf.subarray(ivLen, ivLen + tagLen))
  return d.update(buf.subarray(ivLen + tagLen), undefined, 'utf8') + d.final('utf8')
}

// 1. Recover the REAL token from the installed app's .env
const appEnv = readFileSync(join(APP_DATA, '.env'), 'utf8')
const appKey = readFileSync(join(APP_DATA, '.encryption-key'), 'utf8')
const stored = appEnv.match(/^SHOPIFY_ACCESS_TOKEN=(.*)$/m)?.[1] ?? ''
if (!stored.startsWith('encV1:')) { console.error('installed token not encV1'); process.exit(1) }
const real = dec(appKey, stored.slice(6))
const looksReal = real.length >= 20 && /^[\x00-\xFF]*$/.test(real) && !real.startsWith('•')
console.log(`recovered token: length=${real.length} latin1-safe=${/^[\x00-\xFF]*$/.test(real)} looksReal=${looksReal}`)
if (!looksReal) { console.error('recovered value does not look like a real token — aborting'); process.exit(1) }

// 2. Log in to the dev backend (node fetch → correct UTF-8 everywhere)
// Merge Set-Cookie values into a single cookie jar (one value per name —
// appending blindly duplicates XSRF-TOKEN and the server rejects the mismatch).
function mergeJar(jar, setCookies) {
  const map = new Map()
  for (const part of jar.split('; ').filter(Boolean)) {
    const i = part.indexOf('=')
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1))
  }
  for (const s of setCookies) {
    const kv = s.split(';')[0]
    const i = kv.indexOf('=')
    if (i > 0) map.set(kv.slice(0, i), kv.slice(i + 1))
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function getCsrf(jar) {
  const r = await fetch(`${BASE}/api/v1/csrf-token`, { headers: { Cookie: jar } })
  const newJar = mergeJar(jar, r.headers.getSetCookie?.() ?? [])
  const { csrfToken } = await r.json()
  return { jar: newJar, csrfToken }
}

const boot = await getCsrf('')
const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': boot.csrfToken, Cookie: boot.jar },
  body: JSON.stringify({ username: 'admin', password: 'Opal@2026' }),
})
console.log('login:', login.status)
if (!login.ok) process.exit(1)
const loggedInJar = mergeJar(boot.jar, login.headers.getSetCookie?.() ?? [])
const afterLogin = await getCsrf(loggedInJar)

// 3a. Repair .env via env-config POST (rewrites file + process.env)
const envCfg = await fetch(`${BASE}/api/v1/env-config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': afterLogin.csrfToken, Cookie: afterLogin.jar },
  body: JSON.stringify({ values: { SHOPIFY_ACCESS_TOKEN: real } }),
})
console.log('env-config repair:', envCfg.status, JSON.stringify(await envCfg.json()))

// 3b. Repair the DB row via connections PUT (encrypts + reloads runtime config)
const conn = await fetch(`${BASE}/api/v1/db/settings/connections`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': afterLogin.csrfToken, Cookie: afterLogin.jar },
  body: JSON.stringify({ shopifyAccessToken: real }),
})
const connBody = await conn.json()
console.log('connections repair:', conn.status, 'shopifyTest=', JSON.stringify(connBody.shopify ?? connBody).slice(0, 120))

// 4. Verify
const test = await fetch(`${BASE}/api/v1/shopify/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': afterLogin.csrfToken, Cookie: afterLogin.jar },
  body: '{}',
})
console.log('shopify/test:', JSON.stringify(await test.json()))

// 5. Confirm masking still holds on reads
const ge = await (await fetch(`${BASE}/api/v1/env-config`, { headers: { Cookie: afterLogin.jar } })).json()
const v = ge.values?.SHOPIFY_ACCESS_TOKEN ?? ''
console.log('GET masked:', v.startsWith('•') ? `yes …${v.slice(-4)}` : `NO — got: ${JSON.stringify(v).slice(0, 40)}`)
