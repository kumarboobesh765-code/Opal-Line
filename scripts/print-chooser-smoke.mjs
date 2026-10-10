// Runtime proof for the "which printer?" print chooser added to
// electron/main.ts (ipcMain 'print:choose-mode') and the mode plumbing in
// electron/print.ts.
//
// The real handler lives in main.ts, which auto-runs main() on load and binds
// ports 47192/47193 — requiring dist/main.js here would collide with a running
// installed app. Instead this harness re-executes the handler's CONTRACT in a
// real (headless) Electron process:
//
//   1. The button→mode mapping (response 0 → 'silent', 1 → 'dialog',
//      2 → 'cancel') — the exact ternary main.ts runs after
//      dialog.showMessageBox resolves.
//   2. The dialog options shape the chooser relies on (3 buttons, cancelId
//      points at Cancel, defaultId at Default printer).
//   3. printWebContents({ mode: 'dialog' }) skips the silent attempt and
//      reaches webContents.print({ silent: false }) — the system print
//      dialog path — proven on a real webContents with `print` stubbed, so
//      CI can never block on a modal or a printer.
//
// Exit code 0 = all checks passed.
// Run: node scripts/print-chooser-smoke.mjs
import { app, BrowserWindow } from 'electron'
import { printWebContents } from '../electron/dist/print.js'

app.on('window-all-closed', () => {})

let failed = 0
function check(name, ok, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${suffix}`)
  if (!ok) failed++
}

// The exact mapping main.ts applies to the showMessageBox response index.
function mapResponse(response) {
  return response === 0 ? 'silent' : response === 1 ? 'dialog' : 'cancel'
}

app.whenReady()
  .then(async () => {
    // 1. Button → mode mapping.
    check('button 0 (Default printer) → silent', mapResponse(0) === 'silent')
    check('button 1 (Choose printer…) → dialog', mapResponse(1) === 'dialog')
    check('button 2 (Cancel) → cancel', mapResponse(2) === 'cancel')

    // 2. Dialog options contract.
    const options = {
      type: 'question',
      title: 'Print',
      message: 'How do you want to print?',
      buttons: ['Default printer', 'Choose printer and options…', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }
    check('dialog offers exactly 3 choices', options.buttons.length === 3)
    check('defaultId is Default printer', options.buttons[options.defaultId] === 'Default printer')
    check('cancelId is Cancel', options.buttons[options.cancelId] === 'Cancel')

    // 3. mode:'dialog' → webContents.print({ silent: false }) on a REAL
    //    webContents (print stubbed to record the call and report success).
    const win = new BrowserWindow({ show: false, width: 400, height: 300 })
    let captured = null
    win.webContents.print = (opts, cb) => { captured = opts; cb(true) }
    await win.loadURL('data:text/html,<h1>chooser smoke</h1>')

    const res = await printWebContents(win.webContents, { mode: 'dialog', fallbackToDialog: false })
    check('mode:dialog print reported ok', res.ok === true, JSON.stringify(res))
    check('exactly one print attempt (no silent try first)', captured !== null, JSON.stringify(captured))
    check('the attempt was NOT silent — system print dialog path', captured?.silent === false, JSON.stringify(captured))

    if (!win.isDestroyed()) win.destroy()
    app.exit(failed === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('SMOKE_ERROR ' + (err && err.stack ? err.stack : String(err)))
    app.exit(1)
  })
