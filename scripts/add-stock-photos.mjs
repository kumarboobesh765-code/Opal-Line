// Stock product photography for every product, then push to Shopify.
//
// Phase A (default):  search Openverse (CC0/PDM first) → download → upload
//                      through the app → replace local gallery via PATCH.
// Phase B (--push):    push all products in chunks → the new sync logic
//                      deletes placeholder listing images and writes the
//                      Shopify CDN image URLs back into the local row.
// Phase C (--verify):  confirm local refs are cdn.shopify.com, re-push to
//                      prove idempotency (no dupes, no deletions).
//
// Images live only as files in backend/uploads (gitignored) + CDN URLs in the
// DB — never as bytes in the database, never in git.
//
// Usage: node scripts/add-stock-photos.mjs [--api http://localhost:4197] [--push] [--verify]
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const API = arg('api', 'http://localhost:4197')
const DO_PUSH = process.argv.includes('--push')
const DO_VERIFY = process.argv.includes('--verify')
const SKUS = (() => {
  const i = process.argv.indexOf('--skus')
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].split(',').map((s) => s.trim()) : null
})()
const ATTRIB_PATH = new URL('../scripts/stock-attribution.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const jar = new Map()
const mergeJar = (sc) => {
  for (const c of sc) {
    const [pair] = c.split(';')
    const [k, v] = pair.split('=')
    jar.set(k.trim(), v.trim())
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(), ...(opts.headers || {}) },
  })
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  if (sc.length) mergeJar(sc)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

async function login() {
  await api('/api/v1/csrf-token')
  const t = (await api('/api/v1/csrf-token')).body?.csrfToken ?? ''
  const r = await api('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'X-CSRF-Token': t },
    body: JSON.stringify({ username: 'admin', password: 'Opal@2026' }),
  })
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`)
}

async function allProducts() {
  const all = []
  for (let page = 1; page <= 10; page++) {
    const r = await api(`/api/v1/db/products?page=${page}&pageSize=50`)
    const rows = Array.isArray(r.body?.data) ? r.body.data : []
    all.push(...rows)
    if (rows.length < 50) break
  }
  return all
}

function searchTerms(products) {
  const KEYWORDS = ['anklet', 'bracelet', 'chain', 'necklace', 'earring', 'ring', 'bangle', 'pendant', 'mangalsutra', 'locket']
  const termOf = (p) => {
    const hay = `${p.name ?? ''} ${p.category ?? ''}`.toLowerCase()
    const hit = KEYWORDS.find((k) => hay.includes(k))
    return hit ? `${hit} silver jewellery` : 'silver jewellery'
  }
  return { termOf }
}

async function openverse(term) {
  const urls = [
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license=cc0,pdm&page_size=20&mature=false`,
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license_type=commercial&page_size=20&mature=false`,
  ]
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let u = 0; u < urls.length; u++) {
      try {
        const res = await fetch(urls[u], { headers: { 'User-Agent': 'OpalLineBilling/1.0' } })
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 30000)); continue }
        if (!res.ok) continue
        const j = await res.json()
        const results = (j.results ?? []).filter((r) => r.url)
        if (results.length) return { results, relaxed: u === 1 }
      } catch { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  return { results: [], relaxed: false }
}

async function download(url) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    const res = await fetch(url, { headers: { 'User-Agent': 'OpalLineBilling/1.0 (catalogue imagery)' }, signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function phaseAttach() {
  let products = await allProducts()
  if (SKUS) {
    products = products.filter((p) => SKUS.includes(String(p.sku)))
    console.log(`SKU filter → ${products.length} products`)
  }
  console.log(`products: ${products.length}`)
  const { termOf } = searchTerms(products)

  // one Openverse search per distinct term
  const terms = [...new Set(products.map(termOf))]
  console.log(`distinct search terms (${terms.length}):`, terms.join(' | '))
  const pools = {}
  const attributions = []
  for (const term of terms) {
    const { results, relaxed } = await openverse(term)
    pools[term] = results
    if (relaxed && results[0]) {
      attributions.push({ term, results: results.slice(0, 5).map((r) => ({ title: r.title, creator: r.creator, license: r.license, url: r.url })) })
    }
    console.log(`  "${term}" → ${results.length} candidates${relaxed ? ' (attribution licenses)' : ' (cc0/pdm)'}`)
    await sleep(SKUS ? 2000 : 14000) // stay inside Openverse anonymous rate limits
  }
  if (attributions.length) {
    writeFileSync(ATTRIB_PATH, JSON.stringify(attributions, null, 2))
    console.log(`attribution requirements saved to stock-attribution.json (${attributions.length} terms)`)
  }

  const counters = {}
  let attached = 0, skipped = 0, failed = 0
  for (const p of products) {
    const term = termOf(p)
    const pool = pools[term] ?? []
    if (!pool.length) { skipped++; continue }
    const i = counters[term] ?? 0
    counters[term] = i + 1
    // walk the pool until a download works (max 4 tries)
    let dataUrl = null, used = null
    for (let k = 0; k < Math.min(4, pool.length); k++) {
      const cand = pool[(i + k) % pool.length]
      dataUrl = await download(cand.url)
      if (dataUrl) { used = cand; break }
      if (!dataUrl) dataUrl = await download(cand.thumbnail || '')
      if (dataUrl) { used = cand; break }
    }
    if (!dataUrl) { failed++; console.log(`  ✗ ${p.sku}: no downloadable image`); continue }
    const up = await api('/api/v1/uploads/image', {
      method: 'POST',
      headers: { 'X-CSRF-Token': (await api('/api/v1/csrf-token')).body.csrfToken },
      body: JSON.stringify({ dataUrl }),
    })
    const path = up.body?.paths?.[0]
    if (up.status !== 200 || !path) { failed++; console.log(`  ✗ ${p.sku}: upload ${up.status}`); continue }
    const patch = await api(`/api/v1/db/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'X-CSRF-Token': (await api('/api/v1/csrf-token')).body.csrfToken },
      body: JSON.stringify({ image: path, images: [path] }),
    })
    if (patch.status === 200) { attached++; if (used?.license && used.license !== 'cc0' && used.license !== 'pdm') {} }
    else { failed++; console.log(`  ✗ ${p.sku}: patch ${patch.status} ${JSON.stringify(patch.body).slice(0, 100)}`) }
    if ((attached + failed) % 10 === 0) console.log(`  …${attached} attached, ${failed} failed`)
  }
  console.log(`ATTACH DONE: attached=${attached} skipped=${skipped} failed=${failed}`)
}

async function phasePush() {
  const products = await allProducts()
  const ids = products.map((p) => p.id)
  console.log(`pushing ${ids.length} products…`)
  let updated = 0, created = 0, errors = 0
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8)
    const t = (await api('/api/v1/csrf-token')).body.csrfToken
    const r = await api('/api/v1/shopify/products/push', {
      method: 'POST',
      headers: { 'X-CSRF-Token': t },
      body: JSON.stringify({ ids: chunk }),
    })
    if (r.status === 200 && r.body?.ok) {
      updated += r.body.updated ?? 0
      created += r.body.created ?? 0
      const errs = r.body.errors ?? []
      if (errs.length) { errors += errs.length; console.log('  chunk errors:', errs.slice(0, 2).join(' | ')) }
    } else {
      errors++
      console.log(`  chunk ${i / 8} FAILED: ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`)
    }
    console.log(`  pushed ${Math.min(i + 8, ids.length)}/${ids.length}`)
    await sleep(500)
  }
  console.log(`PUSH DONE: created=${created} updated=${updated} errorChunks/msgs=${errors}`)
}

async function phaseVerify() {
  const products = await allProducts()
  const withLocal = products.filter((p) => p.image && String(p.image).startsWith('/uploads/'))
  const withCdn = products.filter((p) => p.image && String(p.image).includes('cdn.shopify.com'))
  const withOther = products.filter((p) => p.image && !String(p.image).startsWith('/uploads/') && !String(p.image).includes('cdn.shopify.com'))
  console.log(`local refs → uploads:${withLocal.length} cdn:${withCdn.length} other:${withOther.length} (of ${products.length})`)
  if (withOther.length) console.log('  other sample:', withOther.slice(0, 3).map((p) => String(p.image).slice(0, 70)))

  // re-push must be a no-op (idempotent)
  const ids = products.map((p) => p.id)
  let changed = 0, errs = 0
  for (let i = 0; i < ids.length; i += 8) {
    const t = (await api('/api/v1/csrf-token')).body.csrfToken
    const r = await api('/api/v1/shopify/products/push', {
      method: 'POST',
      headers: { 'X-CSRF-Token': t },
      body: JSON.stringify({ ids: ids.slice(i, i + 8) }),
    })
    if (r.status === 200 && r.body?.ok) changed += (r.body.created ?? 0) + (r.body.updated ?? 0)
    else errs++
    await sleep(500)
  }
  console.log(`RE-PUSH: rows processed=${changed} (should stay 0 idempotent), errors=${errs}`)
}

async function main() {
  await login()
  if (DO_VERIFY) await phaseVerify()
  else if (DO_PUSH) await phasePush()
  else await phaseAttach()
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
