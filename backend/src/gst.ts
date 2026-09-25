/**
 * GST reconciliation math, kept framework-free so it can be unit tested
 * without a database or Express (see gst.test.ts).
 */

const num = (v: unknown): number => Number(v ?? 0) || 0

export interface PurchaseTaxRow {
  /** GST amount charged on the purchase invoice (the `tax` column). */
  tax: unknown
  status?: unknown
}

/**
 * Input GST credit: sum the tax of purchase invoices, excluding cancelled
 * ones. Mirrors the output-side filters in the GST reconciliation report.
 */
export function computeInputGst(rows: PurchaseTaxRow[]): number {
  return rows
    .filter((p) => String(p.status ?? '').toLowerCase() !== 'cancelled')
    .reduce((sum, p) => sum + num(p.tax), 0)
}

/**
 * Net GST payable to the authorities. When the input credit exceeds the
 * output liability the result floors at zero — the excess credit carries
 * forward rather than producing a negative payable.
 */
export function netPayable(outputGst: number, inputGst: number): number {
  return Math.max(0, outputGst - inputGst)
}
