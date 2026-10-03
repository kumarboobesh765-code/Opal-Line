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

## Known gaps in what shipped

Real weaknesses in the above, worth picking up before it becomes a surprise.

- **Purchase tables only reach installs whose bootstrap predates purchases via
  the two upgrade paths** (`applyUpgrades` in `bootstrap.ts` and `migrate.ts`).
  Both now create the parent tables, and this is verified against a
  reconstructed pre-purchase database. There is still no automated test that
  runs this on every build — it is verified by hand. A regression here is
  silent, because upgrade statements are swallowed per-statement.
- **Scheduler delays are clamped by hand.** `setTimeout` cannot exceed 2³¹−1 ms
  (~24.85 days); anything longer fires immediately and, if the callback
  re-arms and runs the job, spins forever. The monthly statements scheduler hit
  exactly this and pinned a core until it was fixed. Only schedulers further out
  than ~24 days are affected, so a new long-interval job will reintroduce it.
  There is no shared scheduler helper that clamps and re-checks for everyone.
- **Seeded demo data is only as good as the fields it fills.** Orders shipped an
  `items` count with no `line_items`, so packing slips printed nothing. The
  e2e suite caught it, but only because CI's fresh-install path skips on empty
  tables — CI would not have caught it.
- **Backend oxlint sits at 47 warnings** (frontend is at 0).

## Next candidates

- Watch one real update cycle end-to-end (1.0.8 → 1.0.9) on a live machine
  before announcing the release; CI pins checks to `ubuntu-24.04` ahead of
  GitHub's `ubuntu-latest` → Ubuntu 26 migration on October 19, 2026.
- A shared scheduler helper that clamps long delays and re-checks the due time,
  replacing the per-module `schedule()` implementations.
- A migration smoke test: build a pre-purchase database in CI and assert the
  upgrade path produces the full schema.
- Live silver-rate provider hardening (retry/backoff tuning, rate-limited API
  fallback cache).
- PDF invoice branding options (logo, footer terms) exposed in Settings.