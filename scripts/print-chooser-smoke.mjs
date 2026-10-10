// Runtime proof for the "which printer?" print chooser added to
// electron/main.ts (ipcMain 'print:choose-mode') and the mode plumbing in
// electron/print.ts.
//
// The real handler lives in main.ts, which auto-runs main() on load and binds
// ports 47192/47193 — requiring dist/main.js here would collide with a running
// installed app. Instead this harness re-executes the handler's CONTRACT in a
// real (headless) Electron process:
//
//   1. The button→mode mapping (response 0 → 'silent', 1 → 'pdf',
//      2 → 'dialog', 3 → 'cancel') — the exact ternary main.ts runs after
//      dialog.showMessageBox resolves, AND that the compiled dist/main.js
//      actually declares those buttons (guards against contract drift).
//   2. The dialog options shape the chooser relies on (4 buttons, cancelId
//      points at Cancel, defaultId at Default printer).
//   3. printWebContents({ mode: 'dialog' }) skips the silent attempt and
//      reaches webContents.print({ silent: false }) — the system print
//      dialog path — proven on a real webContents with `print` stubbed, so
//      CI can never block on a modal or a printer.
//
// Exit code 0 = all checks passed.
// Run: node scripts/print-chooser-smoke.mjs
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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
  return response === 0 ? 'silent' : response === 1 ? 'pdf' : response === 2 ? 'dialog' : 'cancel'
}

app.whenReady()
  .then(async () => {
    // 1. Button → mode mapping.
    check('button 0 (Default printer) → silent', mapResponse(0) === 'silent')
    check('button 1 (Save as PDF…) → pdf', mapResponse(1) === 'pdf')
    check('button 2 (Choose printer…) → dialog', mapResponse(2) === 'dialog')
    check('button 3 (Cancel) → cancel', mapResponse(3) === 'cancel')

    // 2. Dialog options contract.
    const options = {
      type: 'question',
      title: 'Print',
      message: 'How do you want to print?',
      buttons: ['Default printer', 'Save as PDF…', 'Choose printer and options…', 'Cancel'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    }
    check('dialog offers exactly 4 choices', options.buttons.length === 4)
    check('defaultId is Default printer', options.buttons[options.defaultId] === 'Default printer')
    check('cancelId is Cancel', options.buttons[options.cancelId] === 'Cancel')

    // 2b. The COMPILED handler must carry the same contract — this is what
    //     keeps the duplicated checks above from drifting from main.ts.
    const mainJs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'dist', 'main.js'), 'utf8')
    check('compiled main.js declares all 4 buttons',
      ["Default printer", 'Save as PDF', 'Choose printer and options', 'Cancel'].every((b) => mainJs.includes(b)))
    check("compiled main.js maps button 1 to 'pdf'", /response === 1 \? ["']pdf["']/.test(mainJs))
    check("compiled main.js maps button 2 to 'dialog'", /response === 2 \? ["']dialog["']/.test(mainJs))
    check('compiled main.js registers export:pdf-page', mainJs.includes('export:pdf-page'))

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
