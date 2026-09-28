import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLockout, LOCKOUT_THRESHOLD, LOCKOUT_DURATION_MS } from './lockout'

const NOW = 1_000_000_000_000

describe('decideLockout', () => {
  test('threshold and window constants', () => {
    assert.equal(LOCKOUT_THRESHOLD, 5)
    assert.equal(LOCKOUT_DURATION_MS, 15 * 60 * 1000)
  })

  test('no stored state → fresh counter', () => {
    assert.deepEqual(decideLockout(0, undefined, NOW), { decision: 'reset', count: 1 })
  })

  test('few failures inside window stay allowed and count up', () => {
    assert.deepEqual(decideLockout(0, NOW - 1000, NOW), { decision: 'allowed', count: 1 })
    assert.deepEqual(decideLockout(1, NOW - 1000, NOW), { decision: 'allowed', count: 2 })
    assert.deepEqual(decideLockout(3, NOW - 1000, NOW), { decision: 'allowed', count: 4 })
  })

  test('the threshold-th failure inside the window locks', () => {
    const d = decideLockout(4, NOW - 1000, NOW)
    assert.equal(d.decision, 'locked')
    if (d.decision === 'locked') assert.equal(d.retryableAt, NOW - 1000 + LOCKOUT_DURATION_MS)
  })

  test('failures beyond the threshold stay locked', () => {
    assert.equal(decideLockout(9, NOW - 1000, NOW).decision, 'locked')
  })

  test('old failure outside the window restarts the counter', () => {
    assert.deepEqual(decideLockout(4, NOW - LOCKOUT_DURATION_MS - 1, NOW), { decision: 'reset', count: 1 })
  })

  test('boundary: exactly at window age counts as outside (window is strict)', () => {
    assert.deepEqual(decideLockout(4, NOW - LOCKOUT_DURATION_MS, NOW), { decision: 'reset', count: 1 })
  })

  test('NaN timestamps are treated as no stored state', () => {
    assert.deepEqual(decideLockout(3, Number.NaN, NOW), { decision: 'reset', count: 1 })
  })
})
