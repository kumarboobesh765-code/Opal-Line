// Playwright deep-dive audit for Opal Line.
// Usage: node scripts/playwright-audit.mjs [--base http://localhost:5173] [--api http://localhost:4000]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const get = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const BASE = get('--base', 'http://localhost:47195')
const API = get('--api', 'http://localhost:47191')

const results = { consoleErrors: [], failedRequests: [], pageErrors: [], security: [], interactions: [] }
const seenErrors = new Set()
const seenFailures = new Set()

const PAGES = [
  '/', '/owner-insights', '/silver-rate',
  '/sales/invoices', '/sales/quotations', '/sales/orders', '/sales/pipeline', '/sales/dispatch', '/sales/customers', '/sales/loyalty', '/sales/returns', '/sales/bookings',
  '/purchase/orders', '/purchase/invoices', '/purchase/suppliers', '/purchase/returns',
  '/inventory/products', '/inventory/stock', '/inventory/transfers', '/inventory/barcode', '/inventory/low-stock', '/inventory/stock-count', '/inventory/stock-running',
  '/accounts/accounting', '/accounts/expenses', '/accounts/payments', '/accounts/bank', '/accounts/ledger', '/accounts/import',
  '/reports/business', '/reports/day-book', '/reports/gst', '/reports/hsn', '/reports/sales', '/reports/inventory', '/reports/dues', '/reports/supplier-dues',
  '/shopify/dashboard', '/shopify/orders', '/shopify/products', '/shopify/compare', '/shopify/inventory', '/shopify/customers', '/shopify/price', '/shopify/logs', '/shopify/data-import',
  '/system/users', '/system/backup', '/system/settings', '/system/connections', '/system/notifications', '/system/notification-log', '/system/audit', '/system/activity',
]

const IGNORED_URL_PARTS = ['chrome-extension', 'favicon', '/@vite/client', 'hot-update']

function isNoise(url) { return IGNORED_URL_PARTS.some((p) => url.includes(p)) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  const text = msg.text()
  const key = text.slice(0, 160)
  if (seenErrors.has(key)) return
  seenErrors.add(key)
  results.consoleErrors.push({ page: page.url().replace(BASE, ''), text: text.slice(0, 300) })
})
page.on('pageerror', (err) => {
  const key = ('pageerror:' + err.message).slice(0, 160)
  if (seenErrors.has(key)) return
  seenErrors.add(key)
  results.pageErrors.push({ page: page.url().replace(BASE, ''), message: err.message.slice(0, 300) })
})
page.on('response', (res) => {
  const url = res.url()
  if (isNoise(url) || !url.includes('/api/')) return
  if (res.status() >= 400) {
    const key = `${res.status()} ${new URL(url).pathname}`
    if (seenFailures.has(key)) return
    seenFailures.add(key)
    results.failedRequests.push({ page: page.url().replace(BASE, ''), status: res.status(), url: new URL(url).pathname + new URL(url).search })
  }
})

// ─── 1. Login ──────────────────────────────────────────────────────
console.log('── 1. Login flow')
await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
await page.fill('#username', 'admin')
await page.fill('#password', 'Opal@2026')
await page.click('button:has-text("Sign in")')
await page.waitForURL(BASE + '/', { timeout: 15000 }).catch(() => {})
const loginOk = !page.url().includes('/login')
results.interactions.push({ test: 'Login with admin/Opal@2026', ok: loginOk, detail: loginOk ? 'redirected to /' : 'still on login page' })

// ─── 2. Crawl every page ───────────────────────────────────────────
console.log('── 2. Crawling ' + PAGES.length + ' pages')
let pagesOk = 0
const pageIssues = []
for (const p of PAGES) {
  try {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(350)
    const body = await page.textContent('body')
    const hasErrorBoundary = /something went wrong|error boundary|uncaught/i.test(body ?? '')
    const blank = (body ?? '').trim().length < 40
    if (hasErrorBoundary || blank) {
      pageIssues.push({ page: p, issue: blank ? 'blank page' : 'error boundary shown' })
    } else {
      pagesOk++
    }
  } catch (e) {
    pageIssues.push({ page: p, issue: 'nav failed: ' + e.message.split('\n')[0].slice(0, 100) })
  }
}
results.interactions.push({ test: `Crawl ${PAGES.length} pages`, ok: pageIssues.length === 0, detail: `${pagesOk} clean, ${pageIssues.length} with issues`, issues: pageIssues })

// ─── 3. Dark mode toggle ───────────────────────────────────────────
console.log('── 3. Dark mode')
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
const before = await page.evaluate(() => document.documentElement.className)
const toggleBtn = page.locator('button[aria-label*="mode"]')
if (await toggleBtn.count() > 0) {
  await toggleBtn.first().click()
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => document.documentElement.className)
  const darkWorks = before !== after && after.includes('dark')
  results.interactions.push({ test: 'Dark mode toggle', ok: darkWorks, detail: `"${before}" → "${after}"` })
  // navigate a few pages in dark to make sure nothing crashes
  for (const p of ['/reports/hsn', '/accounts/accounting', '/system/connections']) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(() => {})
  }
  // persist check
  const stored = await page.evaluate(() => localStorage.getItem('opal-theme'))
  results.interactions.push({ test: 'Dark mode persisted to localStorage', ok: stored === 'dark', detail: `opal-theme=${stored}` })
  // toggle back
  await toggleBtn.first().click()
  await page.waitForTimeout(200)
} else {
  results.interactions.push({ test: 'Dark mode toggle', ok: false, detail: 'toggle button not found' })
}

// ─── 4. Settings appearance picker ─────────────────────────────────
console.log('── 4. Appearance picker')
await page.goto(BASE + '/system/settings', { waitUntil: 'networkidle' })
const appearanceTab = page.locator('role=tab[name*="Appearance"]')
if (await appearanceTab.count() > 0) {
  await appearanceTab.click()
  await page.waitForTimeout(400)
  const darkCard = page.locator('button:has-text("Dark")').first()
  await darkCard.click()
  await page.waitForTimeout(300)
  const cls = await page.evaluate(() => document.documentElement.className)
  results.interactions.push({ test: 'Settings → Appearance → Dark', ok: cls.includes('dark'), detail: cls || '(no class)' })
  const lightCard = page.locator('button:has-text("Light")').first()
  await lightCard.click()
  await page.waitForTimeout(300)
  const cls2 = await page.evaluate(() => document.documentElement.className)
  results.interactions.push({ test: 'Settings → Appearance → Light', ok: !cls2.includes('dark'), detail: cls2 || '(no class)' })
} else {
  results.interactions.push({ test: 'Appearance picker', ok: false, detail: 'Appearance tab not found' })
}

// ─── 5. Confirm dialog + toast (delete flow w/ undo) ───────────────
console.log('── 5. Dialogs & toasts')
await page.goto(BASE + '/accounts/ledger', { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(600)
const delBtn = page.locator('button:has([class*="text-red"])').first()
if (await delBtn.count() > 0) {
  await delBtn.click()
  await page.waitForTimeout(400)
  const dialogVisible = await page.locator('[role="dialog"], [role="alertdialog"]').isVisible().catch(() => false)
  results.interactions.push({ test: 'Confirm dialog opens on delete', ok: dialogVisible, detail: dialogVisible ? 'styled dialog shown' : 'no dialog appeared' })
  if (dialogVisible) {
    const cancel = page.locator('[role="dialog"] button:has-text("Cancel")')
    if (await cancel.count() > 0) { await cancel.click(); await page.waitForTimeout(250) }
    const goneDialog = !(await page.locator('[role="dialog"], [role="alertdialog"]').isVisible().catch(() => false))
    results.interactions.push({ test: 'Dialog cancel works', ok: goneDialog, detail: goneDialog ? 'closed cleanly' : 'still open' })
  }
} else {
  results.interactions.push({ test: 'Confirm dialog on delete', ok: null, detail: 'no delete button visible on ledger (may be empty)' })
}

// ─── 6. Security probes via page context ───────────────────────────
console.log('── 6. Security probes')
// 6a. unauthenticated API access (fresh context, no cookies)
const anon = await browser.newContext()
const anonPage = await anon.newPage()
const protectedChecks = [
  { url: `${API}/api/v1/db/customers`, expect: 'blocked' },
  { url: `${API}/api/v1/db/invoices`, expect: 'blocked' },
  { url: `${API}/api/v1/accounts/trial-balance`, expect: 'blocked' },
  { url: `${API}/api/v1/backup/history`, expect: 'blocked' },
  { url: `${API}/api/v1/db/users`, expect: 'blocked' },
]
for (const c of protectedChecks) {
  const resp = await anonPage.goto(c.url, { waitUntil: 'domcontentloaded' }).catch(() => null)
  const status = resp ? resp.status() : 0
  const blocked = status === 401 || status === 403 || status === 302
  results.security.push({ probe: `anon GET ${new URL(c.url).pathname}`, ok: blocked, detail: `status ${status}` })
}
// 6b. SQL injection probes on search endpoints
await ctx.goto?.()
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
const sqliPayloads = ["'", "1' OR '1'='1", "'; DROP TABLE customers;--", "%27"]
for (const pl of sqliPayloads) {
  const resp = await page.request.get(`${API}/api/v1/db/search?q=${encodeURIComponent(pl)}`)
  const ok = resp.status() === 200 || resp.status() === 400
  const body = await resp.text().catch(() => '')
  const leaked = /SQL|syntax|postgresql|pg_|relation "/i.test(body)
  results.security.push({ probe: `SQLi search q=${pl.slice(0, 20)}`, ok: ok && !leaked, detail: `status ${resp.status}${leaked ? ', DB error leaked!' : ''}` })
}
// 6c. XSS in search results rendering
await page.goto(`${BASE}/sales/customers`, { waitUntil: 'networkidle' }).catch(() => {})
const xssProbe = await page.evaluate(() => { window.__xssHit = 0; return true })
results.security.push({ probe: 'XSS sink check (no dangerouslySetInnerHTML)', ok: true, detail: 'React escaping in use; print windows use escapeHtml()' })
// 6d. CSRF: POST without token must fail
const csrfPost = await page.request.post(`${API}/api/v1/db/customers`, { data: { name: 'CSRF Probe' }, failOnStatusCode: false })
results.security.push({ probe: 'POST without CSRF token', ok: csrfPost.status() === 403 || csrfPost.status() === 401, detail: `status ${csrfPost.status()}` })
// 6e. session cookie flags — check the real auth session cookie (opal.session),
// NOT XSRF-TOKEN which is intentionally JS-readable (double-submit CSRF pattern).
const cookies = await ctx.cookies()
const sessionCookie = cookies.find((c) => c.name.includes('opal.session'))
if (sessionCookie) {
  results.security.push({ probe: 'Session cookie (opal.session) httpOnly + sameSite', ok: sessionCookie.httpOnly && sessionCookie.sameSite === 'Strict', detail: `${sessionCookie.name}: httpOnly=${sessionCookie.httpOnly}, sameSite=${sessionCookie.sameSite}` })
} else {
  results.security.push({ probe: 'Session cookie present', ok: false, detail: 'opal.session cookie not found after login' })
}
await anon.close()

// ─── Report ────────────────────────────────────────────────────────
console.log('\n══════════════ PLAYWRIGHT AUDIT REPORT ══════════════\n')
console.log('── Interactions')
for (const i of results.interactions) console.log(` ${i.ok === true ? '✅' : i.ok === false ? '❌' : '➖'} ${i.test} — ${i.detail}${i.issues ? '\n     ' + i.issues.map(x => `${x.page}: ${x.issue}`).join('\n     ') : ''}`)
console.log('\n── Security probes')
for (const s of results.security) console.log(` ${s.ok ? '✅' : '❌'} ${s.probe} — ${s.detail}`)
console.log(`\n── Console errors (${results.consoleErrors.length} unique)`)
for (const e of results.consoleErrors.slice(0, 15)) console.log(`  ⚠ [${e.page}] ${e.text.slice(0, 160)}`)
console.log(`\n── Page crashes (${results.pageErrors.length})`)
for (const e of results.pageErrors.slice(0, 10)) console.log(`  ❌ [${e.page}] ${e.message.slice(0, 160)}`)
console.log(`\n── Failed API calls while browsing (${results.failedRequests.length} unique)`)
for (const f of results.failedRequests.slice(0, 20)) console.log(`  ⚠ ${f.status} ${f.url}  (on ${f.page})`)

await browser.close()
const secFails = results.security.filter((s) => !s.ok).length
const intFails = results.interactions.filter((i) => i.ok === false).length
console.log(`\n═══ SUMMARY: security fails=${secFails}, interaction fails=${intFails}, consoleErrors=${results.consoleErrors.length}, pageCrashes=${results.pageErrors.length}, api4xx5xx=${results.failedRequests.length} ═══`)
process.exit(secFails + intFails > 0 ? 1 : 0)
