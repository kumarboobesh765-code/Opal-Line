/**
 * Unit tests for the stock ledger's pure rules.
 *
 * These are the parts that are easy to get subtly wrong and that corrupt the
 * books silently rather than throwing: the signed-quantity convention, the
 * weighted-average revaluation, which location may adopt a pre-ledger balance,
 * and what a stock count may post. They are unit-testable because they are
 * pure — the database-backed behaviour around them is covered by the
 * upgrade-path test and the live checks.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOCATION_ID,
  isInflow,
  nextBalanceAtLocation,
  nextCostAfterStockIn,
  normalizeMovementQty,
  openingEntryDate,
  receiptVariance,
  shouldAdoptPreLedgerBalance,
  shouldBackfillOpening,
} from './stock'
import { stockAtLocation, stockCountDelta } from './stockCount'

test('normalizeMovementQty', async (t) => {
  await t.test('floors fractional quantities to whole units', () => {
    assert.equal(normalizeMovementQty({ sku: 'X', qty: 3.9 }), 3)
    // Flooring, not truncating: -3.9 becomes -4. Every in-app caller passes an
    // integer already (deltas, transfer quantities, counts), so this only
    // matters for a hand-rolled API call. Pinned here so a change to truncation
    // has to be deliberate.
    assert.equal(normalizeMovementQty({ sku: 'X', qty: -3.9 }), -4)
  })

  await t.test('rejects a movement that nets to zero', () => {
    assert.equal(normalizeMovementQty({ sku: 'X', qty: 0 }), null)
    assert.equal(normalizeMovementQty({ sku: 'X', qty: 0.4 }), null)
  })

  await t.test('rejects a missing SKU rather than writing a junk movement', () => {
    assert.equal(normalizeMovementQty({ sku: '', qty: 5 }), null)
    assert.equal(normalizeMovementQty({ sku: '   ', qty: 5 }), null)
  })

  await t.test('treats junk quantities as zero, so they are skipped', () => {
    assert.equal(normalizeMovementQty({ sku: 'X', qty: 'abc' }), null)
    assert.equal(normalizeMovementQty({ sku: 'X', qty: null }), null)
    assert.equal(normalizeMovementQty({ sku: 'X', qty: NaN }), null)
  })

  await t.test('keeps the sign, which is what actually moves stock', () => {
    // The type is only a label; a positive quantity always ADDS stock. Getting
    // this backwards is how a sale ends up increasing inventory.
    assert.equal(normalizeMovementQty({ sku: 'X', qty: 5 }), 5)
    assert.equal(normalizeMovementQty({ sku: 'X', qty: -5 }), -5)
  })
})

test('isInflow', async (t) => {
  await t.test('classifies the movements that bring stock in', () => {
    for (const type of ['purchase_in', 'sale_return_in', 'transfer_in', 'shopify_sync', 'opening'] as const) {
      assert.equal(isInflow(type), true, `${type} should be an inflow`)
    }
  })

  await t.test('classifies the movements that remove stock', () => {
    for (const type of ['sale_out', 'purchase_return_out', 'transfer_out', 'count_adjust', 'manual'] as const) {
      assert.equal(isInflow(type), false, `${type} should not be an inflow`)
    }
  })
})

test('nextBalanceAtLocation', async (t) => {
  await t.test('adds stock in', () => {
    assert.equal(nextBalanceAtLocation({ currentAtLocation: 7, qty: 3 }), 10)
  })

  await t.test('removes stock out', () => {
    assert.equal(nextBalanceAtLocation({ currentAtLocation: 7, qty: -3 }), 4)
  })

  await t.test('allows a negative balance when more leaves than was there', () => {
    // The ledger records what happened rather than silently clamping; a
    // negative balance is a real signal that something upstream is wrong.
    assert.equal(nextBalanceAtLocation({ currentAtLocation: 2, qty: -5 }), -3)
  })

  await t.test('tolerates junk stored balances', () => {
    assert.equal(nextBalanceAtLocation({ currentAtLocation: Number.NaN, qty: 4 }), 4)
    assert.equal(nextBalanceAtLocation({ currentAtLocation: '3' as unknown as number, qty: 1 }), 4)
  })
})

test('shouldAdoptPreLedgerBalance', async (t) => {
  await t.test('the default location adopts stock that predates the ledger', () => {
    assert.equal(
      shouldAdoptPreLedgerBalance({ isFirstAtLocation: true, locationId: DEFAULT_LOCATION_ID, productHasAnyLevel: false }),
      true,
    )
  })

  await t.test('a brand new location starts empty', () => {
    // Otherwise the first transfer into a new shop would inherit the whole
    // existing position and double-count it.
    assert.equal(
      shouldAdoptPreLedgerBalance({ isFirstAtLocation: true, locationId: 'LOC-NEW', productHasAnyLevel: false }),
      false,
    )
  })

  await t.test('a product already tracked elsewhere does not re-adopt', () => {
    assert.equal(
      shouldAdoptPreLedgerBalance({ isFirstAtLocation: true, locationId: DEFAULT_LOCATION_ID, productHasAnyLevel: true }),
      false,
    )
  })

  await t.test('never applies once the location already has a row', () => {
    assert.equal(
      shouldAdoptPreLedgerBalance({ isFirstAtLocation: false, locationId: DEFAULT_LOCATION_ID, productHasAnyLevel: false }),
      false,
    )
  })
})

test('nextCostAfterStockIn', async (t) => {
  await t.test('revalues on a weighted average', () => {
    // 10 @ 100 then 10 @ 120 => 20 @ 110
    assert.equal(nextCostAfterStockIn({ oldStock: 10, oldCost: 100, addedQty: 10, unitValue: 120 }), 110)
  })

  await t.test('adopts the buy price when stock is on hand with no cost', () => {
    // Averaging against a meaningless zero would divide the new purchase
    // across nothing and understate it.
    assert.equal(nextCostAfterStockIn({ oldStock: 5, oldCost: 0, addedQty: 5, unitValue: 200 }), 200)
    assert.equal(nextCostAfterStockIn({ oldStock: 5, oldCost: 0, addedQty: 5, unitValue: 200.5 }), 200.5)
  })

  await t.test('adopts the buy price for the very first stock', () => {
    assert.equal(nextCostAfterStockIn({ oldStock: 0, oldCost: 0, addedQty: 3, unitValue: 75 }), 75)
  })

  await t.test('rounds to two decimals', () => {
    // (3 x 10 + 1 x 11.005) / 4 = 10.25125 => 10.25
    assert.equal(nextCostAfterStockIn({ oldStock: 3, oldCost: 10, addedQty: 1, unitValue: 11.005 }), 10.25)
    // (3 x 10 + 1 x 11.006) / 4 = 10.2515 => 10.25
    assert.equal(nextCostAfterStockIn({ oldStock: 3, oldCost: 10, addedQty: 1, unitValue: 11.006 }), 10.25)
    // (3 x 10 + 1 x 11.024) / 4 = 10.256 => 10.26
    assert.equal(nextCostAfterStockIn({ oldStock: 3, oldCost: 10, addedQty: 1, unitValue: 11.024 }), 10.26)
  })

  await t.test('rounds at the half-cent, floating point notwithstanding', () => {
    // (3 x 10 + 1 x 11.02) / 4 is exactly 10.255 in decimal, but lands on
    // 10.254999999999999 in binary. Math.round pushes it to 10.26. Pinned so a
    // future "fix" to the rounding cannot silently move a half-paisa.
    assert.equal(nextCostAfterStockIn({ oldStock: 3, oldCost: 10, addedQty: 1, unitValue: 11.02 }), 10.26)
  })

  await t.test('leaves the cost alone when nothing was added', () => {
    assert.equal(nextCostAfterStockIn({ oldStock: 10, oldCost: 99, addedQty: 0, unitValue: 500 }), 99)
    assert.equal(nextCostAfterStockIn({ oldStock: 10, oldCost: 99, addedQty: 5, unitValue: 0 }), 99)
  })
})

test('stockAtLocation', async (t) => {
  await t.test('coerces a stored balance that may be null or a string', () => {
    assert.equal(stockAtLocation(undefined), 0)
    assert.equal(stockAtLocation(null), 0)
    assert.equal(stockAtLocation('12'), 12)
    assert.equal(stockAtLocation(7.8), 7)
  })
})

test('stockCountDelta', async (t) => {
  await t.test('set mode posts the difference to reach the counted quantity', () => {
    assert.equal(stockCountDelta(10, 12, 'set'), 2)
    assert.equal(stockCountDelta(10, 8, 'set'), -2)
    assert.equal(stockCountDelta(0, 5, 'set'), 5)
  })

  await t.test('set mode posts nothing when the count already matches', () => {
    assert.equal(stockCountDelta(10, 10, 'set'), 0)
  })

  await t.test('adjust mode applies the counted value as a delta', () => {
    assert.equal(stockCountDelta(10, 3, 'adjust'), 3)
    assert.equal(stockCountDelta(10, -3, 'adjust'), -3)
  })

  await t.test('is measured against the location balance, not the global total', () => {
    // 12 across two locations, 4 counted at the location being counted.
    // Using the cross-location rollup as the baseline would post -8 and
    // silently strip 8 units from the wrong shop.
    const globalTotal = 12
    const atThisLocation = 4
    assert.equal(stockCountDelta(atThisLocation, 4, 'set'), 0)
    assert.equal(stockCountDelta(globalTotal, 4, 'set'), -8)
  })
})

test('shouldBackfillOpening', async (t) => {
  await t.test('backfills a product with stock and no ledger history', () => {
    assert.equal(shouldBackfillOpening({ stock: 7, hasLevel: false, hasMovement: false }), true)
  })

  await t.test('leaves products with no stock alone', () => {
    assert.equal(shouldBackfillOpening({ stock: 0, hasLevel: false, hasMovement: false }), false)
  })

  await t.test('is idempotent — never twice for the same product', () => {
    assert.equal(shouldBackfillOpening({ stock: 7, hasLevel: true, hasMovement: false }), false)
    assert.equal(shouldBackfillOpening({ stock: 7, hasLevel: false, hasMovement: true }), false)
    assert.equal(shouldBackfillOpening({ stock: 7, hasLevel: true, hasMovement: true }), false)
  })
})

test('openingEntryDate', async (t) => {
  await t.test('dates the entry from the product record, not the upgrade', () => {
    assert.equal(openingEntryDate('2026-01-15T00:00:00.000Z'), '2026-01-15T00:00:00.000Z')
  })

  await t.test('falls back to now when the date is missing or unusable', () => {
    const now = new Date('2026-10-03T12:00:00.000Z')
    assert.equal(openingEntryDate(null, now), '2026-10-03T12:00:00.000Z')
    assert.equal(openingEntryDate(undefined, now), '2026-10-03T12:00:00.000Z')
    assert.equal(openingEntryDate('not-a-date', now), '2026-10-03T12:00:00.000Z')
  })
})

test('receiptVariance', async (t) => {
  await t.test('is zero for a clean delivery', () => {
    assert.equal(receiptVariance(6, 6), 0)
  })

  await t.test('is negative when goods are short in transit', () => {
    assert.equal(receiptVariance(6, 4), -2)
  })

  await t.test('is positive when more turns up than was sent', () => {
    assert.equal(receiptVariance(6, 7), 1)
  })

  await t.test('handles nothing being received at all', () => {
    assert.equal(receiptVariance(6, 0), -6)
  })
})