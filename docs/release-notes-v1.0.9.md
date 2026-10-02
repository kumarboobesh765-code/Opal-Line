# Opal Line Billing — v1.0.9 Release Notes

> Feature release: the purchase module is now complete, and the outstanding
> sales reporting work has landed. Also fixes several correctness bugs that made
> the purchase data unreliable on installs created before v1.0.9.

## Purchases

- **Purchase invoices are line-item based** — each invoice carries its own lines
  with quantity, weight, rate and tax, and receiving an invoice pushes stock in.
  Editing an invoice's lines is supported from the invoice list. (#52)
- **Supplier payments post to a ledger** — every payment is allocated across
  invoices, advancing each one's paid amount and leaving a running balance.
- **Supplier dues aging** — outstanding balances are bucketed by how late they
  are (current / 1–30 / 31–60 / 60+ days), with an on-demand view.
- **Input GST is split correctly** — CGST+SGST for intra-state purchases, IGST
  for inter-state, and TCS tracked as its own line rather than folded into tax.
  The GST reports now show TCS collected separately and exclude it from net
  payable. (#52)
- **Purchase invoices can be deleted** — a hard delete that reverses the stock it
  added and cascades its lines. Cancelling remains available as the softer
  option. (#52)
- **Purchase returns reverse stock** — returns record line items against the
  original invoice, and stock moves back out only as a return leaves the
  `received` state. (#52)
- **Supplier payments are atomic** — the payment, its allocations and the
  invoice balance advances all commit in a single transaction under a row lock,
  so a failure can no longer leave a payment recorded with balances unmoved.
  (#52)
- **Purchase orders reconcile against invoices** — invoices can be linked to the
  order they fulfill, and each order shows ordered vs. received quantity and
  weight, with shortfalls and overages called out. Cancelled invoices are
  ignored in the variance. (#52)
- **Stock-in revalues cost on a weighted average** — `products.cost_price` is
  revalued as `(oldStock × oldCost + addedQty × unitValue) / newStock` instead of
  being left at its previous book value. Stock removals do not revalue.
  (#52)
- **Daily supplier dues reminder** — a single consolidated email of outstanding
  supplier balances, sent once a day at 09:20, with a manual
  `POST /db/supplier-dues/sweep` trigger for on-demand runs. (#52)

## Sales

- **Quotation lifecycle** — quotations can be created from an opportunity, sent,
  and tracked through accepted / rejected / expired, with a daily 10:05 follow-up
  sweep for quotations sitting too long without a decision. (#52)
- **Dashboard metrics aggregated in SQL** with a receivables aging drill-down,
  empty states and print export. (#50)
- **HSN-wise summary** on sales reporting. (#52)
- **Loyalty points reverse on returns** instead of being left earned. (#52)
- **Reorder velocity** — turnover-based reorder suggestions rather than a flat
  stock threshold. (#52)
- **E-invoice generation** for registered buyers. (#52)
- **Silver rate approval gate** — staff-proposed rates require approval before
  they take effect, with real history and auto-rate status. (#51)

## Fixes

These matter most on installs that predate v1.0.9:

- **Purchase tables were never created on upgrade.** The purchase DDL lived only
  in the fresh-install path, so an existing installation that ran the upgrade
  found no purchase tables at all. The DDL now runs from the upgrade path too.
- **Inter-state purchases were charged CGST+SGST.** The business state code was
  derived from the address instead of the GSTIN, so a purchase from outside the
  state was taxed twice at the state level. The GSTIN state code is now
  authoritative, with the address only as a fallback.
- **A duplicate invoice number returned a 500** instead of a 400.
- **A metadata-only PATCH wiped an invoice's line items.**
- **Reinstating a cancelled invoice left stock short** — cancelling now preserves
  the line items and reinstating genuinely restores stock.
- **The 60+ day aging bucket was unreachable** — bucket boundaries disagreed with
  the app's own convention.
- **The dashboard summed raw tax**, ignoring the CGST/SGST/IGST split and
  counting cancelled invoices.
- **PurchaseInvoices memo dependency** — the edit handler was recreated on every
  render, so the column definitions re-evaluated each time. Frontend oxlint is
  back to 0 warnings / 0 errors, as in v1.0.8.

## Migration

No manual step. Purchase schema changes are applied automatically on upgrade via
`backend/src/db/migrate.ts` and the bootstrap upgrade path; new installs create
the same tables up front.

## Verification (this release)

- Backend: 146/146 tests, `tsc --noEmit` clean.
- Frontend: oxlint 0 warnings / 0 errors, `tsc -b` + production build OK.
- Live checks against a real PostgreSQL database covering all seven purchase
  followups (50 assertions) plus 27 regression checks over the earlier purchase
  work, with the database returned to a clean state afterwards.
- CI checks remain pinned to `ubuntu-24.04` ahead of GitHub's
  `ubuntu-latest` → Ubuntu 26 migration on October 19, 2026.