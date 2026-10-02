/**
 * GST reconciliation math, kept framework-free so it can be unit tested
 * without a database or Express (see gst.test.ts).
 */

const num = (v: unknown): number => Number(v ?? 0) || 0

export interface PurchaseTaxRow {
  /** GST amount charged on the purchase invoice (the `tax` column). */
  tax: unknown
  status?: unknown
  /** Input CGST — used when the supplier's GSTIN is known. */
  cgst?: unknown
  /** Input SGST. */
  sgst?: unknown
  /** Input IGST (supplier in another state). */
  igst?: unknown
  /** Tax collected at source on bullion (194Q). */
  tcsAmount?: unknown
  /** The TCS rate applied, for reporting back. */
  tcsRate?: unknown
}

/**
 * Input GST credit: sum the tax of purchase invoices, excluding cancelled
 * ones. Mirrors the output-side filters in the GST reconciliation report.
 *
 * When the invoice carries a CGST/SGST/IGST split (supplier GSTIN on file),
 * that split is authoritative — it is what actually lands in the return —
 * and the undifferentiated `tax` column is only used as a fallback for
 * invoices recorded before the split existed.
 */
export function computeInputGst(rows: PurchaseTaxRow[]): number {
  return rows
    .filter((p) => String(p.status ?? '').toLowerCase() !== 'cancelled')
    .reduce((sum, p) => {
      const split = num(p.cgst) + num(p.sgst) + num(p.igst)
      return sum + (split > 0 ? split : num(p.tax))
    }, 0)
}

/**
 * Net GST payable to the authorities. When the input credit exceeds the
 * output liability the result floors at zero — the excess credit carries
 * forward rather than producing a negative payable.
 */
export function netPayable(outputGst: number, inputGst: number): number {
  return Math.max(0, outputGst - inputGst)
}

/**
 * Tax collected at source on bullion purchases (s.194Q).
 *
 * TCS is deliberately NOT input credit — the buyer collects it from the
 * supplier and deposits it on their behalf, so it is a liability in its own
 * right (GSTR-3B "TCS collected") rather than something that reduces the
 * output GST. Cancelled invoices are excluded, exactly like the input credit.
 */
export function computeTcs(rows: PurchaseTaxRow[]): number {
  return rows
    .filter((p) => String(p.status ?? '').toLowerCase() !== 'cancelled')
    .reduce((sum, p) => sum + num(p.tcsAmount), 0)
}
