// Measures click → dialog-visible latency inside the page:
//   tDom  = ms from click until [role=dialog] exists (React mount cost)
//   tVis  = ms until overlay/content opacity > 0.03 (first visible frame)
//   tFull = ms until opacity > 0.97 (animation done)
// Run: PROBE_BASE=http://127.0.0.1:47192 node scripts/dialog-lag-probe.js
const { chromium } = require('playwright')

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:47192'
const TARGETS = [
  { name: 'Customers/Add', path: '/sales/customers', match: 'Add Customer' },
  { name: 'Products/Add', path: '/inventory/products', match: 'Add' },
]
const RUNS = 5

async function measureOnce(page, t) {
  return page.evaluate((match) => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(match))
    if (!btn) return { error: 'trigger not found: ' + match }
    const t0 = performance.now()
    btn.click()
    let tDom = null
    let tVis = null
    let tFull = null
    return new Promise((resolve) => {
      const step = () => {
        const dlg = document.querySelector('[role="dialog"]')
        const now = performance.now() - t0
        if (dlg && tDom === null) tDom = now
        if (dlg) {
          const overlay = dlg.previousElementSibling
          const o = overlay ? parseFloat(getComputedStyle(overlay).opacity) : 0
          const c = parseFloat(getComputedStyle(dlg).opacity)
          if (tVis === null && (o > 0.03 || c > 0.03)) tVis = now
          if (tVis !== null && (o > 0.97 || c > 0.97)) {
            tFull = now
            resolve({ tDom, tVis, tFull })
            return
          }
        }
        if (now > 5000) {
          resolve({ tDom, tVis, tFull, timeout: true })
          return
        }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }, t.match)
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ baseURL: BASE, storageState: 'e2e/.auth/state.json' })
  const page = await ctx.newPage()
  // Fresh session for the target backend (cookie secret may differ per backend).
  const login = await ctx.request.post(BASE + '/api/v1/auth/login', {
    data: { username: 'admin', password: 'Opal@2026' },
  }).catch(() => null)
  console.log('login status: ' + (login ? login.status() : 'n/a'))
  for (const t of TARGETS) {
    const results = []
    for (let i = 0; i < RUNS; i++) {
      await page.goto(t.path)
      try {
        await page.waitForSelector(`button:has-text("${t.match}")`, { timeout: 15000 })
      } catch (err) {
        console.log(`NOT_FOUND ${t.name} url=${page.url()}\nbody=${(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 600)}\nbuttons=${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40)))}`)
        throw err
      }
      await page.waitForTimeout(400)
      const r = await measureOnce(page, t)
      results.push(r)
      // close the dialog before the next run
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(300)
    }
    const ok = results.filter((r) => !r.error && !r.timeout)
    const avg = (k) => (ok.length ? Math.round(ok.reduce((s, r) => s + r[k], 0) / ok.length) : NaN)
    console.log(
      `${t.name} @ ${BASE}: runs=${results.length} ok=${ok.length} ` +
        `DOM=${avg('tDom')}ms visible=${avg('tVis')}ms full=${avg('tFull')}ms ` +
        `samples=${JSON.stringify(results)}`,
    )
  }
  await browser.close()
})().catch((e) => {
  console.error('PROBE_FAIL ' + (e.stack || e))
  process.exit(1)
})
