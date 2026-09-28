import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTrustProxy } from './proxyTrust'

describe('resolveTrustProxy', () => {
  test('defaults to 0 when TRUST_PROXY is unset (direct exposure is safe)', () => {
    assert.equal(resolveTrustProxy({}), 0)
  })

  test('treats empty string as unset', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '' }), 0)
  })

  test('accepts 1 and true as a single trusted hop (case/whitespace tolerant)', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '1' }), 1)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'true' }), 1)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'TRUE' }), 1)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: ' true ' }), 1)
  })

  test('keeps 0 and false as explicitly no trust', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '0' }), 0)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false' }), 0)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'FALSE' }), 0)
  })

  test('accepts positive numeric hop counts and floors them', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '2' }), 2)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '3.7' }), 3)
  })

  test('rejects non-positive and non-numeric values as no trust', () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '-1' }), 0)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'yes' }), 0)
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'NaN' }), 0)
  })
})
