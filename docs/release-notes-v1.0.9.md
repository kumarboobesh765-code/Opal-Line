# Opal Line Billing — v1.0.9 Release Notes

> Feature release: the purchase module is now complete, stock gains a real
> ledger with location transfers, and the outstanding sales reporting work has
> landed. Also fixes several correctness bugs that made the purchase and stock
> data unreliable on installs created before v1.0.9.

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

## Inventory & stock

- **Stock is now a ledger, not a single number.** Every movement writes to
  `stock_movements` and updates a per-location balance in `stock_levels` through
  one code path (`applyStockMovement`), and `products.stock` is derived as the
  sum across locations. Sales, purchases, returns, stock counts and transfers
  all route through it, so the history can no longer disagree with the balance.
- **Location transfers actually move stock.** Transfers follow a
  dispatch → receive lifecycle: stock leaves the source on dispatch, lands at
  the destination on receive, and returns to the source on cancel. Cancelling a
  transfer that has already been received is refused, since the goods are at the
  other end. Creating a transfer only records a `pending` document and validates
  that the source holds enough.
- **The Transfers page can drive that lifecycle** — it shows what is available
  at each location, blocks creation when the source is short, and offers a
  Dispatch action on pending transfers.
- **Stock History on the product page** — a per-location balances card plus the
  full movement ledger for a SKU, each line labelled and annotated with the
  resulting on-hand quantity.
- **Stock is valued at cost** — valuation uses `products.cost_price` rather than
  sale price, with the margin shown alongside it on the product page, the
  products list and the stock-running report.
- **Pre-ledger stock is backfilled on upgrade.** Installs that predate the stock
  ledger had `products.stock` set but no movements and no per-location balances,
  so their history rendered empty and the first transfer had nothing to draw
  down. Each affected product now gets one `opening` movement dated from its own
  creation date plus a balance at the default location. The backfill only ever
  seeds the default location and is idempotent, so a re-run is a no-op and a
  later transfer into a fresh location cannot double-count the stock.

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

- **The New Transfer button did nothing.** The UI posted to
  `POST /db/inventory/transfers`, but no generic `POST /db/:resource` route
  existed on the backend, so every attempt 404'd. Transfers now have real
  lifecycle endpoints, and the page was wired to them.
- **A PowerShell console flashed open every time the app started.** Each of the
  15 Electron child-process launches inherited a console window; they are now
  spawned with `windowsHide`.

- **Purchase tables were never created on upgrade.** The purchase DDL lived only
  in the fresh-install path, so an existing installation that ran the upgrade
  found no purchase tables at all. The DDL now runs from the upgrade path too.
  Both upgrade paths (`bootstrap.ts` and `migrate.ts`) now *create* the three
  parent tables rather than only altering them — altering a table that was never
  created fails, and because upgrade statements are swallowed per-statement the
  install booted looking healthy with a completely non-functional purchase
  module. Verified against a database reconstructed from a pre-purchase commit.
- **The monthly statements scheduler could wedge the whole backend.** It armed a
  `setTimeout` for the next 1st-of-month, roughly 29 days out. That exceeds the
  2³¹−1 ms (~24.85 day) ceiling, so Node clamped it to 1 ms and fired
  immediately; the callback re-armed and ran the whole job again, forever,
  pinning a core until health checks stopped responding. Only schedulers further
  out than ~24 days were affected.
- **Seeded sales orders had no line items.** They declared an `items` count but
  no `line_items` payload, so the bulk packing-slip printer treated every seeded
  order as empty and printed nothing.
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

No manual step. Purchase and stock-ledger schema changes are applied
automatically on upgrade via `backend/src/db/migrate.ts` and the bootstrap
upgrade path; new installs create the same tables up front. The opening-balance
backfill runs on boot for existing databases and needs no operator action.

## Verification (this release)

- Backend: 147 tests (146 pass, 1 skip), `tsc --noEmit` clean. The upgrade-path
  test skips unless `UPGRADE_TEST_DATABASE_URL` is set, and CI runs it against a
  PostgreSQL service so a regression in the upgrade path fails the build instead
  of shipping silently. It needs `--test-force-exit` to terminate, because the
  shared drizzle pool keeps the event loop alive.
- Frontend: oxlint 0 warnings / 0 errors, `tsc -b` + production build OK.
- E2E: 52 passed / 1 skipped / 0 failed (Playwright, against the dev stack).
  Note that a freshly bootstrapped database contains only a locked `admin`
  account; the `arjun` fixtures the suite logs in with come from `npm run
  db:seed`, so a green run needs that step first.
- Stock ledger, live against a real PostgreSQL database: 13 assertions covering
  the opening-balance backfill and the transfer lifecycle — the backfill creates
  one `opening` movement dated to the product's creation date, is a no-op on a
  second run, a following sale builds on the opening balance instead of
  replacing it, and a 5-unit transfer leaves source 15 / destination 5 for an
  unchanged total of 20.
- Upgrade path: a database reconstructed from the pre-purchase commit
  `d6de561`, with all purchase tables removed, was upgraded through both
  `applyUpgrades` and `migrate.ts`; all 8 purchase/supplier-payment tables and
  the `products.cost_price`, `purchase_invoices.order_id`,
  `purchase_invoices.tcs_amount` and `purchase_returns.invoice_id` columns were
  present afterwards. Before the fix the same run left 6 of the 8 tables missing
  while reporting success.
- Live checks against a real PostgreSQL database covering all seven purchase
  followups (50 assertions) plus 27 regression checks over the earlier purchase
  work, with the database returned to a clean state afterwards.
- CI checks remain pinned to `ubuntu-24.04` ahead of GitHub's
  `ubuntu-latest` → Ubuntu 26 migration on October 19, 2026.