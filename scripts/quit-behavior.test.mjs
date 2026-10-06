// Proves the two behaviours that were broken in electron/main.ts shutdown,
// using the same primitives the app now uses.
//
//   1. child.kill() on a `shell: true` spawn leaves the real child alive,
//      still holding the port — the original "close the app, ports stay
//      taken" bug.
//   2. taskkill /T (killTree) takes the whole tree down and frees the port.
//
// Run: node --test scripts/quit-behavior.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const FREE_PORT = 47197 // inside the app's 47191-47198 block

// Written outside the checkout on purpose: with `shell: true` Node joins the
// args with spaces and does NOT quote them, so any path containing a space
// (this repo lives under "...\LONI GROUPS DM1\...") gets split mid-argument
// and the child dies with MODULE_NOT_FOUND. A space-free path keeps the test
// about shutdown behaviour rather than about shell quoting.
const PROBE = join(tmpdir(), 'opal-quit-probe.js')
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '.quit-probe.js'), PROBE)

function listeningPid() {
  try {
    const out = execSync(`netstat -ano | findstr :${FREE_PORT} | findstr LISTENING`, {
      encoding: 'utf8', timeout: 6000, stdio: 'pipe', shell: 'cmd.exe', windowsHide: true,
    })
    const line = out.split('\n').find((l) => l.trim().length > 0)
    return line ? (line.trim().split(/\s+/).pop() ?? null) : null
  } catch { return null }
}

async function waitFor(pred, ms = 9000) {
  const start = Date.now()
  for (;;) {
    const v = pred()
    if (v) return v
    if (Date.now() - start > ms) return null
    await new Promise((r) => setTimeout(r, 200))
  }
}

function treeKill(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 8000, shell: 'cmd.exe', windowsHide: true })
    return true
  } catch { return false }
}

/** Spawn the way dev mode does: a shell whose child owns the port. */
function spawnShell() {
  assert.ok(existsSync(PROBE), `probe script missing: ${PROBE}`)
  return spawn('cmd.exe', ['/c', 'node', PROBE, String(FREE_PORT)], {
    shell: true, stdio: 'ignore', windowsHide: true,
  })
}

async function cleanupProbes() {
  try { rmSync(PROBE, { force: true }) } catch { /* best effort */ }
}

after(cleanupProbes)

test('child.kill() on a shell:true spawn orphans the child that holds the port', async (t) => {
  const shell = spawnShell()
  t.after(() => treeKill(shell.pid))

  const listener = await waitFor(listeningPid)
  assert.ok(listener, `probe child should bind ${FREE_PORT}`)
  assert.notEqual(listener, String(shell.pid), 'the listener is the child, not the shell — that is the orphan risk')

  shell.kill() // the OLD shutdown path: only the direct child dies
  await new Promise((r) => setTimeout(r, 2000))

  const survivor = listeningPid()
  assert.ok(
    survivor,
    `expected the orphaned grandchild to still hold ${FREE_PORT} after shell.kill(); port is free, so the premise changed`,
  )
  // Clean up the orphan we deliberately created.
  treeKill(Number(survivor))
})

test('killTree (taskkill /T) releases the port', async (t) => {
  const shell = spawnShell()
  t.after(() => treeKill(shell.pid))

  const listener = await waitFor(listeningPid)
  assert.ok(listener, `probe child should bind ${FREE_PORT}`)

  treeKill(shell.pid) // the NEW shutdown path

  const released = await waitFor(() => (listeningPid() ? null : true))
  assert.equal(released, true, `port ${FREE_PORT} should be released after killTree`)
})