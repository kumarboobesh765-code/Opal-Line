/**
 * Pure helpers for the scan stock-count flow (POST /db/inventory/stock-count).
 * Kept side-effect free so validation rules are unit-testable without a DB.
 */

export interface StockCountRow {
  id: string
  counted: number
}

export interface StockCountParseResult {
  rows: StockCountRow[]
  errors: string[]
}

export const STOCK_COUNT_MAX_ITEMS = 500

/**
 * Validate and normalise a raw counts payload:
 *  - `id` must be a non-empty string, `counted` a finite number >= 0
 *  - values are floored to whole units
 *  - at most STOCK_COUNT_MAX_ITEMS rows are accepted, extras are reported as errors
 */
export function buildStockCountRows(raw: unknown): StockCountParseResult {
  const rows: StockCountRow[] = []
  const errors: string[] = []
  const list = Array.isArray(raw) ? raw : []
  for (const c of list.slice(0, STOCK_COUNT_MAX_ITEMS)) {
    const id = String((c as { id?: unknown })?.id ?? '').trim()
    const counted = Number((c as { counted?: unknown })?.counted)
    if (!id || !Number.isFinite(counted) || counted < 0) {
      errors.push(`${id || 'unknown'}: invalid counted value`)
      continue
    }
    rows.push({ id, counted: Math.floor(counted) })
  }
  for (let i = STOCK_COUNT_MAX_ITEMS; i < list.length; i++) {
    errors.push(`item ${i + 1}: over the ${STOCK_COUNT_MAX_ITEMS}-item limit`)
  }
  return { rows, errors }
}
