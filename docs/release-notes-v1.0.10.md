# Opal Line Billing — v1.0.10 Release Notes

> Inventory release: stock stops being a single number and becomes stock you
> can locate, count and explain. Multi-location support across sales,
> purchases, counts and transfers — plus the silent data-corruption bugs that
> having locations exposed.

Everything below shipped after `v1.0.9`. It is one theme: **stock stops being a
single number and starts being stock you can locate, count and explain** — and
the bugs that were silently corrupting it along the way.

## Multi-location inventory

- **Stock locations can be created, with stock counted in as they open.** There
  was previously no way to create a location through the API at all, so opening
  a second store meant hand-counting every item later through a stock count. The
  new Stock Locations page creates a location and counts stock into it in one
  step. Counted quantities post as `opening` movements, which deliberately
  **raises** total stock across locations: this is stock that physically exists
  and belongs to the business, not a split of an existing position. Moving stock
  you already hold elsewhere remains a transfer, so the books cannot quietly
  inflate.
- **Sales are rung up at a location, and stay there.** A sale records the shop it
  happened at, and every later movement on that order — an edit that re-balances
  its lines, a cancellation — moves stock on that same location's balance.
- **Purchases record where the goods were received**, and reversing an invoice
  (edit, cancel, delete) or a return removes stock from the shop the goods
  actually arrived into, not from Main Store.
- **Stock counts name the location they were taken at**, and the count page shows
  each product's balance *at that location*, so the variance on screen is the
  variance that gets applied.
- **Per-location valuation.** The stock-running report has a location view giving
  products held, units, value at cost, value at retail and margin per shop. The
  product view remains the cross-location rollup.

Existing documents keep no location of record and resolve to the default store,
which is exactly where their movements already went.

## Transfers

- **Transfers follow a real lifecycle.** Creating one records a `pending`
  document only; stock leaves the source on dispatch and lands at the
  destination on receive. Cancelling an in-transit transfer returns it to the
  source; cancelling a received one is refused.
- **Receipt variance is recorded.** Goods go missing or turn up extra between
  stores, and that difference had nowhere to live but a manual count adjustment
  afterwards. Receiving now takes the counted quantity and stores it as a
  variance on the transfer, shown in the list and explained in the movement note.
  No correcting movement is needed: dispatch already removed the dispatched
  quantity from the source, so posting only what was counted leaves the total
  correctly lower or higher by exactly the variance.

## Bugs fixed

Most of these are silent — they produce plausible numbers rather than errors.

- **Counting a branch adjusted the wrong shop.** `POST /db/inventory/stock-count`
  posted to the default location whatever you asked for, and took its baseline
  from `products.stock`, the cross-location rollup. With one store those
  coincided by luck; with two, counting a branch adjusted Main Store, measured
  against a total that included stock sitting at the other branch. Wrong
  location and wrong baseline at once.
- **The product form could not actually save stock.** It offered a stock field
  that PATCHed `products.stock` directly, but that column is the rollup across
  `stock_levels` and is recomputed on every movement — so the edit was silently
  undone by the next stock movement of any kind. Updates carrying stock are now
  rejected with an explanation, and the field is read-only when editing.
- **Sales debited Main Store regardless of shop.** Only counts and transfers
  passed a location; every sale, sales return, purchase and email-order sale fell
  through to the default. A branch's balance never fell while Main Store drifted
  negative.
- **The sale availability check used the global total.** A chain can hold 12
  units while the shop actually taking the sale has 2; the check passed and the
  sale drove that shop negative. It is now checked at the location.
- **`stockAt` ignored the SKU when given a location**, returning the total for
  every product held there. Invisible with one location; wrong with two.
- **A date-only stock-history range silently dropped its final day.** The upper
  bound is now widened to the end of that day.

## Stock history

- **Date-range filter and CSV export.** The movement ledger rendered in full with
  no window, so "what left the shop in March" could only be answered by scrolling.
  The export covers whatever range is in view.

## Upgrade notes

`stock_transfers.received_qty` / `variance`, `sales_orders.location_id` and
`purchase_invoices.location_id` are added by the upgrade path. All four are
nullable, so existing rows are unaffected and resolve to the previous behaviour.
The upgrade-path test emulates a pre-feature install by dropping all four and
fails if any ALTER is removed.

## Verification

- Backend: 192 tests (191 pass, 1 skip — the upgrade test needs a database),
  `tsc --noEmit` clean. 45 of those are new unit tests over the stock ledger's
  pure rules.
- Frontend: oxlint 0 warnings / 0 errors, `tsc -b` + production build OK.
- E2E: 54 passed / 1 skipped / 0 failed.
- Live PostgreSQL checks: location-aware counting (16 assertions), `stockAt`
  location filtering (6), the earlier ledger and transfer work (20), and the
  upgrade path proven to fail when the receipt-variance ALTER is removed.