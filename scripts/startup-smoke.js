// Throwaway runtime smoke for the splash + crash-recovery changes (NOT
// committed as a test — it boots the whole app with Postgres).
//
//   1. The window opens with the SPLASH (before the backend is ready).
//   2. It swaps to the real app URL once the backend is up.
//   3. Forcibly crashing the renderer reloads the UI instead of leaving a
//      dead window (render-process-gone handler).
//
// Run from the repo root: node scripts/startup-smoke.js
// Requires: installed app STOPPED (ports 47192/47193 free), dev stack up.
const path = require('node:path')
const { _electron } = require('playwright')

// Forcibly crashing the renderer makes playwright-core throw "Target
// crashed" from a CDP event handler — outside any promise we can catch.
// That crash is EXPECTED here; swallow it and keep polling for recovery.
process.on('uncaughtException', (err) => {
  if (/Target crashed/.test(String(err && err.message))) return
  console.error('UNCAUGHT ' + (err && err.stack ? err.stack : String(err)))
  process.exit(1)
})

async function waitFor(fn, ms, label) {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > ms) throw new Error('timeout waiting for ' + label)
    await new Promise((r) => setTimeout(r, 300))
  }
}

;(async () => {
  const app = await _electron.launch({
    args: [path.join(process.cwd(), 'electron', 'dist', 'main.js')],
    cwd: process.cwd(),
  })

  const win = await app.firstWindow()
  // The window appears before the splash data-URL has painted — poll for the
  // splash text rather than reading once.
  const splash = await waitFor(async () => {
    try {
      const s = await win.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      }))
      return /Starting up/i.test(s.text) ? s : null
    } catch {
      return null
    }
  }, 15000, 'splash text')
  console.log('SPLASH ' + JSON.stringify(splash))

  // Poll rather than waitForURL: the splash → app swap throws
  // "Execution context was destroyed" in playwright mid-navigation.
  const loaded = await waitFor(async () => {
    try {
      const s = await win.evaluate(() => ({
        url: location.href,
        text: document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '',
      }))
      return /localhost:4719[25]/.test(s.url) && s.text.length > 10 ? s : null
    } catch {
      return null // navigation in flight
    }
  }, 60000, 'app URL after backend boot')
  console.log('APP_LOADED ' + JSON.stringify(loaded))

  // Give the app a moment to finish its own rendering before crashing it.
  await new Promise((r) => setTimeout(r, 2000))

  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'window')
    wc.forcefullyCrashRenderer()
  })
  console.log('CRASHED')

  // Poll from the MAIN process — playwright's page handle for the crashed
  // renderer may never revive even when the app itself recovered.
  const recovered = await waitFor(async () => {
    const s = await app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getType() === 'window')
      if (!wc) return null
      return { url: wc.getURL(), crashed: wc.isCrashed(), loading: wc.isLoading() }
    }).catch(() => null)
    return s && !s.crashed && !s.loading && /localhost:4719[25]/.test(s.url) ? s : null
  }, 30000, 'renderer auto-reload (main-process view)')
  console.log('RECOVERED ' + JSON.stringify(recovered))

  try {
    const probe = await win.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 60))
    console.log('RENDERER_PROBE ' + JSON.stringify(probe))
  } catch (err) {
    console.log('RENDERER_PROBE page-handle-dead: ' + String(err).slice(0, 80))
  }

  await app.close()
  console.log('SMOKE_OK')
  process.exit(0)
})().catch((err) => {
  console.error('SMOKE_FAIL ' + (err && err.stack ? err.stack : String(err)))
  process.exit(1)
})
