# Roadmap

Last updated at v1.0.11. See `docs/release-notes-v1.0.11.md` for what that
release changed and `docs/release-notes-v1.0.10.md` for the one before it. This
file previously described "v1.0.2 planned scope" — treat anything below as
current, and check the release notes for what a version actually did.

## Shipped through v1.0.11

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
- **Multi-location inventory** — sales, purchases, counts and transfers all
  post to the location the document happens at, and every reversal resolves
  back to it. Availability is checked at that location rather than against the
  chain-wide total. Stock value breaks down per shop.
- **Transfers UI and stock history** — transfers follow dispatch → receive →
  cancel, the Transfers page shows per-location availability and offers a
  Dispatch action, and the product page carries a Stock History tab that
  explains any balance on screen. Installations that predate the ledger are
  backfilled with dated opening movements on boot.
- **Dependency majors, all four (v1.0.11)** — express 4→5, Tailwind 3→4,
  TypeScript 6→7, dotenv 16→18. No behaviour change; the work was in the
  migration mechanics, and the reasons are written up in `docs/DEVELOPING.md`
  so the next upgrade is not rediscovered from scratch. Two of them needed
  supporting changes rather than a version bump alone: a typed `routeParam`
  helper for express 5's `req.params` union, and a CSS-first theme file for
  Tailwind 4.
- **Release and repository plumbing** — the published installer is signed, and
  CI proves it *works* rather than merely compiling: it installs the app into a
  clean Windows environment, launches it, and runs the UI suite against the
  installed copy. Alongside that: a pre-commit credential guard, a secret scan
  covering git history (not just the working tree), Dependabot with grouped
  updates, a nightly production-dependency audit, and a developer guide.

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
  There is no shared scheduler helper that clamps and re-checks for everyone —
  nine modules each carry their own `schedule()` (`autoBackup`, `dueReminders`,
  `monthlyStatements`, `orderEmailIngest`, `ownerWeekly`, `productAutoSync`,
  `salesFollowups`, `silverRateScheduler`, `supplierPayables`).
- **Seeded demo data is only as good as the fields it fills.** Orders shipped an
  `items` count with no `line_items`, so packing slips printed nothing. The
  e2e suite caught it, but only because CI's fresh-install path skips on empty
  tables — CI would not have caught it. Seeded products also carry no `image`,
  which is why the packing-slip thumbnail assertion is now conditional.
- **Stock predates the ledger.** Existing balances were never backfilled as
  movements; the first movement for a product at the default location adopts
  its pre-existing balance as an opening entry. The opening-balance backfill now
  runs on boot and dates the entry from the product's own creation date, so
  pre-ledger products have real history — but the backfill cannot know *when*
  the stock actually arrived, so the quantity is the current balance as of the
  upgrade and any earlier in-and-out is invisible.
- **A new location still has to be counted in, not split.** Creating a location
  now offers to count stock in as it opens, which posts `opening` movements and
  correctly RAISES total stock — but splitting an existing position between
  shops is still all-or-nothing through manual transfers, there is no "split
  half of this line across both" action.
- **Documents created before locations keep no location of record.**
  `sales_orders.location_id` and `purchase_invoices.location_id` are nullable
  and NULL resolves to the default store, which is where those movements already
  went. Nothing backfills them, so a historic branch sale is still attributed to
  Main Store and cannot be re-attributed without editing the row.
- **The stock ledger's pure rules are unit-tested; its database behaviour is
  not.** The signed-quantity convention, cost revaluation, backfill eligibility
  and location rules have 45 tests in `backend/src/stock.test.ts`, but
  `applyStockMovement`'s locking and rollup behaviour is only covered by
  throwaway live scripts that get deleted.
- **Backend lint was never run in CI.** The backend had no `lint` script at all,
  so its warnings accumulated unobserved — 47, then 98, then 97 by v1.0.11 —
  while only the frontend was ever checked. Both are now clean and gated:
  `npm run lint -w backend` runs `oxlint --max-warnings 0` as a required CI
  step, so a new warning fails the build rather than being absorbed into a
  number nobody reads. Two warnings remain suppressed on purpose, both the
  deliberate Latin-1 credential guards in `config.ts` and `shopify.ts` that
  reject masked or corrupted secrets before they reach an HTTP header.
- **`better-sqlite3` is a phantom external.** `scripts/build-desktop.js` passes
  `--external:better-sqlite3`, but the package is not declared in any manifest,
  not imported anywhere, and absent from the lockfile. Harmless today (esbuild
  ignores externals it never encounters) and misleading to the next reader.
- **The dev database cannot be started from a non-interactive shell.** The
  bundled `pg_ctl` dies with `0xC0000142` (DLL init failed) when launched from a
  tool shell, so `npm run dev` needs a real terminal. Not a code defect, but it
  makes "just run it and look" harder than it should be.

## Next candidates

- Support partial and split shipments on a transfer. Dispatch currently moves
  the full quantity or fails, so a transfer that ships part today and the rest
  tomorrow is not representable — the normal case for real inter-store transport.
- Per-location days-of-stock. Values and quantities break down by location, but
  velocity is still computed per SKU across all locations, so a branch with
  5 units shows the same days-of-stock as the chain total.

- Watch one real update cycle end-to-end (1.0.8 → 1.0.9) on a live machine
  before announcing the release; CI pins checks to `ubuntu-24.04` ahead of
  GitHub's `ubuntu-latest` → Ubuntu 26 migration on October 19, 2026.
- A shared scheduler helper that clamps long delays and re-checks the due time,
  replacing the per-module `schedule()` implementations.
- Live silver-rate provider hardening (retry/backoff tuning, rate-limited API
  fallback cache).
- PDF invoice branding options (logo, footer terms) exposed in Settings.