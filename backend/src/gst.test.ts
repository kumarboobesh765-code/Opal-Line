import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { computeInputGst, netPayable } from './gst'

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
