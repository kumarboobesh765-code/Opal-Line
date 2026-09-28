import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isWebhookIdSeen, rememberWebhookId, resetWebhookDedupe, REPLAY_WINDOW_MS } from './webhooks'

describe('webhook replay dedupe', () => {
  beforeEach(() => resetWebhookDedupe())

  test('first sight is unseen, then remembered', () => {
    const t0 = 1_000_000
    assert.equal(isWebhookIdSeen('id-1', t0), false)
    rememberWebhookId('id-1', t0)
    assert.equal(isWebhookIdSeen('id-1', t0 + 1), true)
  })

  test('ids expire after the replay window', () => {
    const t0 = 1_000_000
    rememberWebhookId('id-2', t0)
    assert.equal(isWebhookIdSeen('id-2', t0 + REPLAY_WINDOW_MS - 1), true)
    assert.equal(isWebhookIdSeen('id-2', t0 + REPLAY_WINDOW_MS), false)
  })

  test('expired id can be seen fresh again', () => {
    const t0 = 1_000_000
    rememberWebhookId('id-3', t0)
    assert.equal(isWebhookIdSeen('id-3', t0 + REPLAY_WINDOW_MS + 1), false)
    rememberWebhookId('id-3', t0 + REPLAY_WINDOW_MS + 2)
    assert.equal(isWebhookIdSeen('id-3', t0 + REPLAY_WINDOW_MS + 3), true)
  })

  test('cache is bounded (oldest entry evicted)', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 5100; i++) rememberWebhookId(`bulk-${i}`, t0)
    // The very first id must have been evicted; the newest must survive.
    assert.equal(isWebhookIdSeen('bulk-0', t0), false)
    assert.equal(isWebhookIdSeen('bulk-5099', t0), true)
  })

  test('reset clears everything', () => {
    rememberWebhookId('id-4', 0)
    resetWebhookDedupe()
    assert.equal(isWebhookIdSeen('id-4', 1), false)
  })
})
