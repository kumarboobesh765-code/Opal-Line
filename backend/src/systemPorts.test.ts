/**
 * Port-block diagnostics (47191-47198): the parsers behind the System Status
 * "Port block" card. A "port already in use" report is only useful if it names
 * the process holding the port, so these cover exactly that:
 *   - netstat rows → listening PID (IPv4/IPv6, first row wins, only LISTENING)
 *   - tasklist CSV → image name per PID
 *   - inspectOpalPorts → one entry per reserved port, live on this machine
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  OPAL_PORT_BLOCK,
  inspectOpalPorts,
  parseNetstatListeners,
  parseTasklistCsv,
} from './systemPorts'

const NETSTAT_SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:47192          0.0.0.0:0              LISTENING       21620
  TCP    [::1]:47193            [::]:0                 LISTENING       999
  TCP    127.0.0.1:47191        127.0.0.1:52311        ESTABLISHED     21620
  TCP    0.0.0.0:47192          0.0.0.0:0              LISTENING       31337
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       4
  UDP    0.0.0.0:47195          *:*                                    777
`

const TASKLIST_SAMPLE = `
"System Idle Process","0","Services","0","8 K"
"postgres.exe","999","Services","0","12,345 K"
"Opal Line Billing.exe","21620","Console","1","180,001 K"
"node.exe","31337","Console","1","90,000 K"
garbage line without csv
`

describe('parseNetstatListeners', () => {
  test('keeps only LISTENING TCP rows, mapping port → PID', () => {
    const listeners = parseNetstatListeners(NETSTAT_SAMPLE)
    assert.equal(listeners.get(47192), 21620) // first LISTENING row wins
    assert.equal(listeners.get(47193), 999) // IPv6 local address
    assert.equal(listeners.get(80), 4)
    assert.equal(listeners.has(47191), false) // ESTABLISHED does not block a bind
    assert.equal(listeners.has(47195), false) // UDP has no LISTENING state
    assert.equal(listeners.size, 3)
  })

  test('returns an empty map for empty or unparseable output', () => {
    assert.equal(parseNetstatListeners('').size, 0)
    assert.equal(parseNetstatListeners('not netstat at all').size, 0)
  })
})

describe('parseTasklistCsv', () => {
  test('maps PID → image name and skips garbage rows', () => {
    const images = parseTasklistCsv(TASKLIST_SAMPLE)
    assert.equal(images.get(999), 'postgres.exe')
    assert.equal(images.get(21620), 'Opal Line Billing.exe')
    assert.equal(images.get(31337), 'node.exe')
    assert.equal(images.has(0), false) // PID 0 is not a real holder
    assert.equal(images.size, 3)
  })
})

describe('OPAL_PORT_BLOCK', () => {
  test('covers exactly the reserved 47191-47198 range with labels', () => {
    assert.deepEqual(
      OPAL_PORT_BLOCK.map((p) => p.port),
      [47191, 47192, 47193, 47194, 47195, 47196, 47197, 47198],
    )
    for (const p of OPAL_PORT_BLOCK) assert.ok(p.label.length > 0)
  })
})

describe('inspectOpalPorts', () => {
  test('returns one well-formed entry per reserved port', async () => {
    const ports = await inspectOpalPorts()
    assert.equal(ports.length, OPAL_PORT_BLOCK.length)
    for (const info of ports) {
      assert.ok(OPAL_PORT_BLOCK.some((p) => p.port === info.port))
      assert.equal(typeof info.inUse, 'boolean')
      assert.ok(info.source === 'netstat' || info.source === 'probe')
      if (info.inUse && info.source === 'netstat') {
        assert.ok(info.pid !== null && info.pid > 0)
        assert.equal(info.isSelf, info.pid === process.pid)
      } else {
        assert.equal(info.pid, null)
        assert.equal(info.isSelf, false)
      }
    }
    // This very test process is not a listener, so nothing should be isSelf
    // unless a stray backend is genuinely running on the block.
    const selfHolders = ports.filter((p) => p.isSelf)
    for (const info of selfHolders) assert.equal(info.pid, process.pid)
  })
})
