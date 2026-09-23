// Read-only UI photo verification (no temp products, no deletes):
//   1. pick a real product whose row holds a Shopify CDN image
//   2. products list renders its thumbnail (CDN img, visible)
//   3. product detail renders the hero image (CDN src, visible) + name
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4197'

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
  const next = mergeJar(jar, r.headers.getSetCookie?.() ?? [])
  const { csrfToken } = await r.json()
  return { jar: next, csrfToken }
}

let { jar, csrfToken } = await getCsrf('')
const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Cookie: jar },
  body: JSON.stringify({ username: 'admin', password: 'Opal@2026' }),
})
if (loginRes.status !== 200) { console.error('login failed'); process.exit(1) }
jar = mergeJar(jar, loginRes.headers.getSetCookie?.() ?? [])
;({ jar, csrfToken } = await getCsrf(jar))

// Pick a real product with a CDN image
const pr = await (await fetch(`${BASE}/api/v1/db/products?page=1&pageSize=50`, { headers: { Cookie: jar } })).json()
const rows = pr.data ?? pr.items ?? []
const pick = rows.find((r) => typeof r.image === 'string' && r.image.includes('cdn.shopify.com'))
if (!pick) { console.error('no product with CDN image found'); process.exit(1) }
console.log(`target: ${pick.sku} "${String(pick.name).slice(0, 40)}" id=${pick.id}`)

let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#username', 'admin')
  await page.fill('#password', 'Opal@2026')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 }).catch(() => {})

  // 1. list thumbnail — find an <img> whose src contains the product's CDN file name
  await page.goto(`${BASE}/inventory/products`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const fileName = pick.image.split('/').pop().split('?')[0]
  const listThumb = page.locator(`img[src*="${fileName}"]`).first()
  const listCount = await listThumb.count()
  const listVisible = listCount > 0 && (await listThumb.isVisible().catch(() => false))
  check('List shows the product photo thumbnail', listVisible, `${listCount} match(es)`)

  // 2. detail hero
  await page.goto(`${BASE}/inventory/products/${pick.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const hero = page.locator(`img[src*="${fileName}"]`).first()
  const heroCount = await hero.count()
  const heroVisible = heroCount > 0 && (await hero.isVisible().catch(() => false))
  check('Detail page shows the photo (hero/gallery)', heroVisible, `${heroCount} match(es)`)
  const nameOnPage = await page.getByText(String(pick.name).slice(0, 25)).first().isVisible().catch(() => false)
  check('Detail page shows product name', nameOnPage)
  await page.screenshot({ path: '/tmp/chrome-test/photo-verify-detail.png', fullPage: false })
  console.log('screenshot: /tmp/chrome-test/photo-verify-detail.png')
} catch (e) {
  check('Playwright flow', false, String(e).split('\n')[0].slice(0, 120))
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)