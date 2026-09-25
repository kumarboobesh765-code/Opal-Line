// Generates placeholder product images (rendered via Playwright) for every
// product that has none, attaches them through /db/products/bulk-images
// (SKU-matched filenames), then pushes products to Shopify in chunks.
// Usage: cd frontend && node ../scripts/add-product-images.mjs [--api http://localhost:47191]
import { chromium } from 'playwright'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const DRY = process.argv.includes('--dry-run')
const API = arg('api', 'http://localhost:47191')

const jar = new Map()
function mergeJar(setCookies) {
  for (const c of setCookies) {
    const [pair] = c.split(';')
    const [k, v] = pair.split('=')
    jar.set(k.trim(), v.trim())
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
      ...(opts.headers || {}),
    },
  })
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (sc.length) mergeJar(sc)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
async function csrf() {
  const r = await api('/api/v1/csrf-token')
  return r.body?.csrfToken ?? ''
}

async function main() {
  // 1. login
  await api('/api/v1/csrf-token')
  let r = await api('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'X-CSRF-Token': await csrf() },
    body: JSON.stringify({ username: 'admin', password: 'Opal@2026' }),
  })
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  console.log('login ok')

  // 2. fetch all products (paginated)
  const all = []
  const pageSize = 50
  for (let page = 1; page <= 20; page++) {
    r = await api(`/api/v1/db/products?page=${page}&pageSize=${pageSize}`)
    if (r.status !== 200) throw new Error(`products fetch failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    const j = r.body
    const rows = j.data ?? j.items ?? []
    const arr = Array.isArray(rows) ? rows : (rows.rows ?? [])
    all.push(...arr)
    if (arr.length < pageSize) break
  }
  console.log(`products total: ${all.length}`)

  const targets = all.filter((p) => {
    const gallery = Array.isArray(p.images) ? p.images : []
    return !p.image && gallery.length === 0
  })
  const already = all.length - targets.length
  console.log(`already have images: ${already} | to generate: ${targets.length}`)
  if (targets.length === 0) { console.log('nothing to do'); return }

  // 3. render placeholder PNG per product
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const palettes = [
    ['#0f766e', '#134e4a'], ['#7c3aed', '#4c1d95'], ['#b45309', '#78350f'],
    ['#be123c', '#881337'], ['#0369a1', '#0c4a6e'], ['#4d7c0f', '#365314'],
  ]
  const images = []
  for (const [i, p] of targets.entries()) {
    const [c1, c2] = palettes[i % palettes.length]
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="width:640px;height:640px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:linear-gradient(135deg,${c1},${c2});color:#fff;font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:60px;box-sizing:border-box">
        <div style="font-size:96px;font-weight:300;opacity:.35;line-height:1">${esc(String(p.sku ?? '').slice(0, 2).toUpperCase() || 'OP')}</div>
        <div style="font-size:36px;font-weight:600;margin-top:24px;max-width:520px;word-wrap:break-word">${esc(p.name)}</div>
        <div style="font-size:22px;opacity:.8;margin-top:14px;letter-spacing:2px">SKU ${esc(p.sku ?? '')}</div>
        <div style="margin-top:40px;font-size:16px;opacity:.55;border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:6px 22px">Opal Line Billing</div>
      </div></body></html>`)
    const buf = await page.screenshot({ type: 'jpeg', quality: 82 })
    images.push({ filename: `${String(p.sku ?? p.name)}.jpg`, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, id: p.id })
    if ((i + 1) % 10 === 0) console.log(`  rendered ${i + 1}/${targets.length}`)
  }
  await browser.close()
  console.log(`rendered ${images.length} placeholder images`)

  // 4. attach in batches
  const BATCH = 12
  let matched = 0
  const unmatched = []
  const errors = []
  for (let i = 0; i < images.length; i += BATCH) {
    const batch = images.slice(i, i + BATCH)
    r = await api('/api/v1/db/products/bulk-images', {
      method: 'POST',
      headers: { 'X-CSRF-Token': await csrf() },
      body: JSON.stringify({ images: batch.map(({ filename, dataUrl }) => ({ filename, dataUrl })) }),
    })
    if (r.status !== 200) { errors.push(`batch ${i / BATCH}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`); continue }
    matched += r.body?.matched ?? 0
    unmatched.push(...(r.body?.unmatched ?? []))
    errors.push(...(r.body?.errors ?? []))
    console.log(`  attached batch ${i / BATCH + 1}: matched=${r.body?.matched}`)
  }
  console.log(`attached: matched=${matched}, unmatched=${unmatched.length}, errors=${errors.length}`)
  if (unmatched.length) console.log('unmatched SKUs:', unmatched.slice(0, 10).join(', '))
  if (errors.length) console.log('errors:', errors.slice(0, 5).join(' | '))

  // 5. verify gallery in DB
  r = await api('/api/v1/db/products?page=1&pageSize=50')
  const rows = r.body?.data ?? r.body?.items ?? []
  const arr = Array.isArray(rows) ? rows : (rows.rows ?? [])
  const withImg = arr.filter((p) => p.image || (Array.isArray(p.images) && p.images.length))
  console.log(`verify page1: ${withImg.length}/${arr.length} products have images`)

  // 6. push to Shopify in chunks (synchronous route — keep chunks small)
  const ids = targets.map((p) => p.id)
  const CHUNK = 8
  let created = 0, updated = 0, skipped = 0, pushErrors = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    r = await api('/api/v1/shopify/products/push', {
      method: 'POST',
      headers: { 'X-CSRF-Token': await csrf() },
      body: JSON.stringify({ ids: chunk }),
    })
    if (r.status === 200 && r.body?.ok) {
      created += r.body.created ?? 0
      updated += r.body.updated ?? 0
      skipped += r.body.skipped ?? 0
      if (r.body.errors?.length) pushErrors.push(...r.body.errors)
    } else {
      pushErrors.push(`chunk ${i / CHUNK}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    }
    console.log(`  pushed ${Math.min(i + CHUNK, ids.length)}/${ids.length}`)
  }
  console.log(`push done: created=${created} updated=${updated} skipped=${skipped} errors=${pushErrors.length}`)
  if (pushErrors.length) console.log('push errors:', pushErrors.slice(0, 6).join(' | '))

  // 7. final status
  r = await api('/api/v1/shopify/status')
  console.log('shopify status:', JSON.stringify(r.body?.totals ?? r.body).slice(0, 200))
  console.log(`dry-run flag: ${DRY} (not yet used)`)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
