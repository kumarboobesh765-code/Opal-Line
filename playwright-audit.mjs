/**
 * Playwright E2E security & bug audit for Opal Line ERP.
 * Run: TEST_PASS=... node playwright-audit.mjs
 * Requires: backend :4000, frontend :5173
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:4000/api/v1'
const USER = process.env.TEST_USER || 'arjun'
const PASS = process.env.TEST_PASS
if (!PASS) { console.error('Set TEST_PASS env var'); process.exit(1) }

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))
const isNoise = (e) => /favicon|DevTools|sourcemap|net::ERR_ABORTED|WebSocket|401 \(Unauthorized\)|Failed to load resource/i.test(e)

// ── 1. Login flow through the real UI ────────────────────────────────────────
try {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await page.fill('#username', USER)
  await page.fill('#password', PASS)
  await page.click('button:has-text("Sign in")')
  await page.waitForURL((u) => !String(u).includes('login'), { timeout: 15000 })
  await page.waitForTimeout(1500)
  record('1. UI login succeeds', true, page.url())
} catch (e) {
  record('1. UI login succeeds', false, e.message.slice(0, 120))
}

// ── 2. Wrong password shows error, no session ────────────────────────────────
{
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  try {
    await p2.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await p2.fill('#username', USER)
    await p2.fill('#password', 'wrong-password-xyz')
    await p2.click('button:has-text("Sign in")')
    await p2.waitForTimeout(2500)
    const stillLogin = p2.url().includes('login')
    const errVisible = await p2.locator('text=/invalid|incorrect|wrong|failed/i').count() > 0
    record('2. Bad password rejected in UI', stillLogin && errVisible, `stillOnLogin=${stillLogin} errShown=${errVisible}`)
  } catch (e) {
    record('2. Bad password rejected in UI', false, e.message.slice(0, 120))
  }
  await ctx2.close()
}

// ── 3. Protected route redirects to login when unauthenticated ───────────────
{
  const ctx3 = await browser.newContext()
  const p3 = await ctx3.newPage()
  try {
    await p3.goto(BASE + '/products', { waitUntil: 'networkidle' })
    const redirected = p3.url().includes('login')
    record('3. /products blocked when logged out', redirected, p3.url())
  } catch (e) {
    record('3. /products blocked when logged out', false, e.message.slice(0, 120))
  }
  await ctx3.close()
}

// ── 4. API rejects unauthenticated requests ──────────────────────────────────
{
  const r = await fetch(API + '/db/products')
  record('4. API /db/products rejects anon', r.status === 401 || r.status === 403, `status=${r.status}`)
}

// ── 5. XSS: product name with script tag is escaped in UI ────────────────────
try {
  // Create the XSS probe product through the page itself (same-origin fetch,
  // same cookies + CSRF as the UI session)
  const xss = await page.evaluate(async () => {
    const r = await fetch('/api/v1/csrf-token', { credentials: 'include' })
    const { csrfToken } = await r.json()
    const cr = await fetch('/api/v1/db/products', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ name: 'XSSPROBE<script>window.__xss=1</script>', sku: 'XSSPROBE1', category: 'Ring', sellingPrice: 10, stock: 1 }) })
    return { status: cr.status, body: await cr.json() }
  })
  if (xss.status !== 201) throw new Error('create failed: ' + JSON.stringify(xss.body))
  const prod = xss.body

  // Use a separate page in the SAME context so the UI session stays intact
  const p5 = await ctx.newPage()
  await p5.goto(BASE + '/inventory/products', { waitUntil: 'networkidle' })
  await p5.waitForTimeout(1500)
  const xssFired = await p5.evaluate(() => window.__xss === 1)
  const rawTagVisible = (await p5.content()).includes('<script>window.__xss')
  record('5. XSS payload inert in products list', !xssFired && !rawTagVisible, `executed=${xssFired} rawInDom=${rawTagVisible}`)
  await p5.close()

  // cleanup via the page context too (keeps cookies/CSRF consistent)
  await page.evaluate(async (id) => {
    const r = await fetch('/api/v1/csrf-token', { credentials: 'include' })
    const { csrfToken } = await r.json()
    await fetch('/api/v1/db/products/' + id, { method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken } })
  }, prod.id)
} catch (e) {
  record('5. XSS payload inert in products list', false, e.message.slice(0, 120))
}

// ── 6. SQL injection probe on login ──────────────────────────────────────────
{
  const ctx6 = await browser.newContext()
  const p6 = await ctx6.newPage()
  try {
    await p6.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await p6.fill('#username', "' OR 1=1 --")
    await p6.fill('#password', "anything'--")
    await p6.click('button:has-text("Sign in")')
    await p6.waitForTimeout(2500)
    const stillLogin = p6.url().includes('login')
    record('6. SQLi probe on login fails safely', stillLogin, p6.url())
  } catch (e) {
    record('6. SQLi probe on login fails safely', false, e.message.slice(0, 120))
  }
  await ctx6.close()
}

// ── 7. Products page renders real data ───────────────────────────────────────
try {
  await page.goto(BASE + '/inventory/products', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const rows = await page.locator('table tbody tr').count()
  const countText = await page.locator('text=/of \d+ products/').first().textContent().catch(() => '')
  record('7. Products list renders rows', rows > 0 || /of \d+ products/.test(countText ?? ''), `${rows} rows | "${(countText ?? '').trim().slice(0, 40)}"`)
} catch (e) {
  record('7. Products list renders rows', false, e.message.slice(0, 120))
}

// ── 8. Dashboard loads KPI cards ─────────────────────────────────────────────
try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const body = await page.textContent('body')
  const hasKpi = /today|sales|revenue|stock|product/i.test(body)
  const snapshot = body.replace(/\s+/g, ' ').slice(0, 150)
  record('8. Dashboard renders KPIs', hasKpi, snapshot)
} catch (e) {
  record('8. Dashboard renders KPIs', false, e.message.slice(0, 120))
}

// ── 9. Silver rate page loads ────────────────────────────────────────────────
try {
  await page.goto(BASE + '/silver-rate', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const body = await page.textContent('body')
  record('9. Silver rate page shows rate', /₹|rs|rate/i.test(body))
} catch (e) {
  record('9. Silver rate page shows rate', false, e.message.slice(0, 120))
}

// ── 10. Session cookie flags (HttpOnly, SameSite) ────────────────────────────
{
  const ctx10 = await browser.newContext()
  const p10 = await ctx10.newPage()
  try {
    await p10.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await p10.fill('#username', USER)
    await p10.fill('#password', PASS)
    await p10.click('button:has-text("Sign in")')
    await p10.waitForTimeout(3000)
    const cookies = await ctx10.cookies()
    const sess = cookies.find(c => /session|sid/i.test(c.name))
    if (!sess) record('10. Session cookie flags', false, 'no session cookie found')
    else {
      const httpOnly = sess.httpOnly
      const sameSite = sess.sameSite !== 'None'
      record('10. Session cookie flags', httpOnly && sameSite, `httpOnly=${httpOnly} sameSite=${sess.sameSite}`)
    }
  } catch (e) {
    record('10. Session cookie flags', false, e.message.slice(0, 120))
  }
  await ctx10.close()
}

// ── 11. Console errors during the whole run ──────────────────────────────────
{
  const meaningful = consoleErrors.filter(e => !isNoise(e))
  record('11. No unexpected console errors', meaningful.length === 0,
    meaningful.length ? meaningful.slice(0, 3).join(' | ').slice(0, 200) : 'clean')
}

// ── 12. Logout invalidates session server-side ───────────────────────────────
try {
  // Fresh login via API, then logout with the same session
  const t = await fetch(API + '/csrf-token')
  const csrf = (await t.json()).csrfToken
  const jar = t.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const lg = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar }, body: JSON.stringify({ username: USER, password: PASS }) })
  const cookies2 = [jar, ...lg.headers.getSetCookie().map(c => c.split(';')[0])].join('; ')
  const H2 = { 'Content-Type': 'application/json', Cookie: cookies2, 'x-csrf-token': csrf }
  const lo = await fetch(API + '/auth/logout', { method: 'POST', headers: H2 })
  // After logout, the same session must be rejected
  const after = await fetch(API + '/db/products', { headers: { Cookie: cookies2 } })
  record('12. Logout invalidates session', lo.status === 200 && after.status === 401, `logout=${lo.status} postLogoutApi=${after.status}`)
} catch (e) {
  record('12. Logout invalidates session', false, e.message.slice(0, 120))
}

await browser.close()

const passed = results.filter(r => r.ok).length
console.log(`\n=== ${passed}/${results.length} passed ===`)
const failed = results.filter(r => !r.ok)
if (failed.length) { console.log('FAILURES:'); failed.forEach(f => console.log('  ✗ ' + f.name + ' — ' + f.detail)) }
process.exit(0)
