# Opal Line Billing — v1.0.7 Release Notes

> Contains GitHub PRs #15–#45 stacked on v1.0.6.

## Critical fix

- **Fresh installs could not start** — the `sales_orders` schema declared
  `customer_email`/`customer_phone` twice, so first-run schema bootstrap failed
  and every login died with `relation "rate_limit_hits" does not exist`. The
  duplicate columns are removed and the post-baseline ALTERs now live in an
  idempotent `applyUpgrades()` that runs on both the fresh and the
  existing-database path before seeding. Verified end-to-end on a clean machine
  (install dir + `%APPDATA%` wiped): bundled PostgreSQL initializes, 45 tables
  bootstrap, the generated admin logs in. (#45)

## New Features

### Sales & Customers
- **Customer 360 page** (`/sales/customers/:name`) — contact card, lifetime tiles (orders, value, dues, loyalty points), dues with recent payments, invoice and order tables; the Customers page row button opens it. (#27)
- **Quotation → Sales order conversion** — one-click confirmed order from an approved quote, with line items, shipping address, `from-quotation:<num>` tag, and no stock movement; shopping-bag action on the Quotations page. (#25)

### Printing
- **Packing slip & pick list document types** — fulfilment layouts (no prices/GST), pick-list tick boxes, Packed By / Checked By signature lines, available in the Print Designer with live preview. (#22)
- **Automatic UPI QR on invoices** — generated from Settings UPI ID (grand-total encoded) when no custom QR design is set. (#22)
- **Print template picker** — dropdown of saved Print Designer templates on the invoice detail page and quotation view dialog; pick one to print with that design instantly. (#28)

### Shopify
- **Collections sync** — custom + smart collections attach to products as pipe-separated titles (≤5, tag fallback). (#24)
- **Product descriptions round-trip** — pulled from `body_html` and pushed back through an allowlist sanitizer (scripts/styles/event handlers stripped); description textarea added under Title in the product dialog. (#24)
- **Order-sync duplicate hardening** — in-batch `seenInBatch` dedupe and customer matching reordered to shopifyId → email → phone (keeps genuine duplicate-email identities separate). (#23)
- **Stock-count → Shopify round-trip** — "Push to Shopify" toggle on Scan Stock Count pushes applied counts via the inventory API and reports the result. (#29)

### Operations & Security
- **Backup auto-email** — toggle to attach the 7 PM auto-backup archive to an email (oversize archives are safely skipped). (#26, #32)
- **Dashboard security widget** — failed logins (24 h), locked accounts, recent security events. (#26)
- **Bulk payment reminders** — "Remind All" on Dues emails each due customer and reports skipped count. (#26)
- **Log out other devices** — Settings → Team security card revokes all other sessions for the account, with audit entry. (#30)

## Reliability & Hardening
- **IMAP order-email ingestion no longer crashes the desktop backend** — socket errors are caught and logged. (#44)
- **Update checker survives flaky networks** — the GitHub release lookup retries with backoff instead of surfacing an error dialog. (#45)
- **TRUST_PROXY env gate** — proxy trust is opt-in, not ambient. (#15)
- **Postgres-backed rate limiting** — auth and email limiter counters survive server restarts (`rate_limit_hits`), with login lockout records. (#17)
- **Webhook replay protection** — 3-day seen-id window with DB persistence and memory fallback; duplicate deliveries are acknowledged, not reprocessed. (#20)
- **Upload magic-byte sniffing** — image uploads validated by content, not extension. (#19)
- **CSRF coverage for PATCH/DELETE** verified by e2e; Electron `will-navigate` allowlist guard. (#18)
- **Shared mail attachment budget** — pure, unit-tested 20 MB total / 25 MB per-file rule across all backup email paths. (#32)
- **Duplicate-email advisory** — Customers page banner flags potential duplicate customer emails (two Shopify identities are kept separate by design). (#21)

## Developer / Internal
- **CI builds and tests the actual Windows installer on every push** — the new `desktop-e2e` job builds the signed installer, silent-installs it, boots the app and runs the full Playwright suite against the installed app (bundled PostgreSQL + packaged backend), with a committed installer smoke-test script. (#45)
- TypeScript unified on ~6.0.2 across the workspace. (#16)
- Vite pinned to `127.0.0.1:47195` (strict port); e2e defaults aligned. (#21)
- Backend `index.ts` extraction part 1: system-status/logs and reports routers; unified `recordAudit` helper. (#31)
- Frontend `api.ts` split into `./api/*` modules behind a stable barrel (bundle byte-identical); pino-pretty moved to root devDependencies. (#32)
- README: installer walkthrough with screenshots, port map, database/Shopify sync verification. (#42, #43, #44)
- Test suite grew from 74 → 117 backend tests and 18 → 53 e2e tests.

## Verification (this release)
- Backend: 117/117 tests, `tsc --noEmit` clean.
- Frontend: `tsc -b` clean, production build OK.
- E2E: 52 passed / 1 skipped (dev stack, fixture data present); 46 passed / 7 skipped against a freshly bootstrapped desktop install — every order-dependent test declares its data requirement.
- Clean-machine install test: installer signature valid, bundled PostgreSQL boots on 47193, backend healthy on 47192, generated admin logs in, `/api/v1/db/stats` returns fresh data.
- CI: `desktop-e2e` job green — the full Playwright suite passed against the CI-built, CI-installed app.
