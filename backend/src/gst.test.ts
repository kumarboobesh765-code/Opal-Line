import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInputGst, computeTcs, netPayable } from './gst'

describe('computeInputGst', () => {
  test('sums the tax column over purchase invoice rows', () => {
    const rows = [
      { tax: 100, status: 'received' },
      { tax: '45.5', status: 'pending' },
      { tax: 0, status: 'draft' },
    ]
    assert.equal(computeInputGst(rows), 145.5)
  })

  test('excludes cancelled purchase invoices', () => {
    const rows = [
      { tax: 100, status: 'received' },
      { tax: 999, status: 'cancelled' },
      { tax: 50, status: 'CANCELLED' },
    ]
    assert.equal(computeInputGst(rows), 100)
  })

  test('treats null/undefined tax and status as zero and active', () => {
    const rows = [{ tax: null, status: undefined }, { tax: undefined }, { tax: '30' }]
    assert.equal(computeInputGst(rows), 30)
  })

  test('returns 0 for an empty month', () => {
    assert.equal(computeInputGst([]), 0)
  })
})

describe('netPayable', () => {
  test('output minus input', () => {
    assert.equal(netPayable(3000, 1200), 1800)
  })

  test('floors at zero when input credit exceeds output', () => {
    assert.equal(netPayable(500, 1200), 0)
  })

  test('equal credits net to zero', () => {
    assert.equal(netPayable(1200, 1200), 0)
  })
})

describe('computeTcs', () => {
  test('sums TCS across purchase invoices', () => {
    const rows = [{ tax: 100, tcsAmount: 10 }, { tax: 200, tcsAmount: 20 }]
    assert.equal(computeTcs(rows), 30)
  })

  test('excludes cancelled invoices', () => {
    const rows = [
      { tax: 100, tcsAmount: 10, status: 'received' },
      { tax: 200, tcsAmount: 20, status: 'cancelled' },
    ]
    assert.equal(computeTcs(rows), 10)
  })

  test('is zero when no TCS was collected', () => {
    assert.equal(computeTcs([{ tax: 100 }, { tax: 200, tcsAmount: null }]), 0)
  })

  test('is kept separate from input credit, never netted into it', () => {
    // TCS is a liability collected on the buyer's behalf, not a credit.
    const rows = [{ tax: 1000, tcsAmount: 100 }]
    assert.equal(computeInputGst(rows), 1000)
    assert.equal(computeTcs(rows), 100)
  })
})
