# Roadmap

Last updated at v1.0.9. This file previously described "v1.0.2 planned
scope", including the purchase input-GST work that shipped in v1.0.9 — treat
anything below as current, and check the release notes for what a version did.

## Shipped through v1.0.9

Not outstanding. Listed so the next reader can see what is already done.

- **Purchases, end to end** — line-item invoices with stock-in, hard delete,
  returns that reverse stock, atomic supplier payments, a payment ledger,
  aged dues, CGST/SGST vs IGST splitting, TCS, order-to-invoice reconciliation
  and weighted-average cost on stock-in.
- **Sales reporting** — SQL-backed dashboard metrics, receivables aging
  drill-down, HSN summary, reorder velocity.
- **Quotations** — full lifecycle, send tracking, daily follow-up sweep.
- **Silver rate** — staff approval gate, history, auto-rate status.
- **Loyalty** — reversal on returns.
- **E-invoice** — generation for registered buyers.
- **Stock ledger and per-location balances** — every stock change is an
  append-only movement with the resulting balance; `products.stock` remains the
  rollup. Transfers move stock for real, stock counts record an adjustment
  instead of overwriting silently, and inventory value is reported at cost with
  retail and margin alongside.

## Known gaps in what shipped

Real weaknesses in the above, worth picking up before it becomes a surprise.

- **Purchase tables only reach installs whose bootstrap predates purchases via
  the two upgrade paths** (`applyUpgrades` in `bootstrap.ts` and `migrate.ts`).
  Both now create the parent tables, and a real-database test
  (`src/db/upgrade.test.ts`, run in CI against a PostgreSQL service) rebuilds
  the failure case and asserts the full schema comes back. It is verified to
  fail against the broken code. A regression here is otherwise silent, because
  upgrade statements are swallowed per-statement.
- **Scheduler delays are clamped by hand.** `setTimeout` cannot exceed 2³¹−1 ms
  (~24.85 days); anything longer fires immediately and, if the callback
  re-arms and runs the job, spins forever. The monthly statements scheduler hit
  exactly this and pinned a core until it was fixed. Only schedulers further out
  than ~24 days are affected, so a new long-interval job will reintroduce it.
  There is no shared scheduler helper that clamps and re-checks for everyone.
- **Seeded demo data is only as good as the fields it fills.** Orders shipped an
  `items` count with no `line_items`, so packing slips printed nothing. The
  e2e suite caught it, but only because CI's fresh-install path skips on empty
  tables — CI would not have caught it. Seeded products also carry no `image`,
  which is why the packing-slip thumbnail assertion is now conditional.
- **Stock predates the ledger.** Existing balances were never backfilled as
  movements; the first movement for a product at the default location adopts
  its pre-existing balance as an opening entry. Any product whose stock changed
  before the ledger existed therefore has no history, and its opening balance
  appears dated to whenever that first sale or purchase happened.
- **Location stock starts empty.** A new location begins at zero and is not
  seeded from the current balance, so opening a second store means counting it
  rather than splitting the existing position.
- **Backend oxlint sits at 47 warnings** (frontend is at 0).

## Next candidates

- Watch one real update cycle end-to-end (1.0.8 → 1.0.9) on a live machine
  before announcing the release; CI pins checks to `ubuntu-24.04` ahead of
  GitHub's `ubuntu-latest` → Ubuntu 26 migration on October 19, 2026.
- A shared scheduler helper that clamps long delays and re-checks the due time,
  replacing the per-module `schedule()` implementations.
- A UI for transfers and per-location balances: the endpoints exist and move
  stock correctly, but the Transfers page is still a read-only list of records
  with no way to create one or see per-location stock.
- A stock ledger view: `GET /db/inventory/movements` exists but nothing in the
  UI reads it, so a balance still cannot be explained on screen.
- Backfill opening balances so pre-ledger stock has dated history.
- Live silver-rate provider hardening (retry/backoff tuning, rate-limited API
  fallback cache).
- PDF invoice branding options (logo, footer terms) exposed in Settings.