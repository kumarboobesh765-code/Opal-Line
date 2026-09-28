import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStockCountRows, STOCK_COUNT_MAX_ITEMS } from './stockCount'

test('buildStockCountRows accepts valid ids and floors counted values', () => {
  const { rows, errors } = buildStockCountRows([
    { id: 'p1', counted: 5 },
    { id: ' p2 ', counted: 3.9 },
  ])
  assert.deepEqual(errors, [])
  assert.deepEqual(rows, [
    { id: 'p1', counted: 5 },
    { id: 'p2', counted: 3 },
  ])
})

test('buildStockCountRows rejects invalid entries without throwing', () => {
  const { rows, errors } = buildStockCountRows([
    { id: '', counted: 5 },
    { id: 'p2', counted: -1 },
    { id: 'p3', counted: 'x' },
    null,
    { id: 'p4', counted: 0 },
  ])
  assert.deepEqual(rows, [{ id: 'p4', counted: 0 }])
  assert.equal(errors.length, 4)
  assert.ok(errors.every((e) => typeof e === 'string' && e.length > 0))
})

test('buildStockCountRows tolerates non-array payloads', () => {
  const { rows, errors } = buildStockCountRows(undefined)
  assert.deepEqual(rows, [])
  assert.deepEqual(errors, [])
})

test('buildStockCountRows caps at the max item limit', () => {
  const many = Array.from({ length: STOCK_COUNT_MAX_ITEMS + 5 }, (_, i) => ({ id: `p${i}`, counted: 1 }))
  const { rows, errors } = buildStockCountRows(many)
  assert.equal(rows.length, STOCK_COUNT_MAX_ITEMS)
  assert.equal(errors.length, 5)
})
