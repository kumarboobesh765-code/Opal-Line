# Opal Line ERP — Configuration Guide

Every configuration surface in the project: **environment variables** (backend
`backend/.env`), **in-app settings** (stored in the database, edited via the
Settings UI), and **integration setup** (Shopify, email, WhatsApp, Razorpay,
backups). Each section shows a working example and the steps to apply it.

> Env vars are read once at server start — restart the backend after editing
> `backend/.env`. Values stored in the database (Shopify credentials, SMTP,
> WhatsApp) can be changed live from the UI and **override** env vars.

---

## 1. Core (required)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:secret@localhost:5432/opal_line` | PostgreSQL connection (local install or Neon/Supabase cloud) |
| `PORT` | `47191` | Backend API port |
| `HOST` | `127.0.0.1` | Bind address (default: all interfaces) |
| `NODE_ENV` | `production` | `production` disables pretty logs, verbose error bodies, dev transports |

**Example `backend/.env`:**

```env
DATABASE_URL=postgresql://postgres:S3cret@localhost:5432/opal_line
PORT=47191
```

**Steps (dev machine):**

1. Install PostgreSQL 14+, create a database: `CREATE DATABASE opal_line;`
2. Copy `backend/.env.example` → `backend/.env`, fill `DATABASE_URL`.
3. `npm install` (repo root), then:
   ```bash
   npm run db:push      # create/update all tables
   npm run db:seed      # admin user, roles, settings row
   ```
4. `npm run dev` → UI at `http://127.0.0.1:47195`, API at `http://localhost:47191`.

Cloud database (Neon example) — just swap the URL and keep `sslmode=require`:

```env
DATABASE_URL=postgresql://user:pass@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

## 2. Security

| Variable | Example | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | 64-char hex | AES-256-GCM key encrypting secrets stored in DB (Shopify token, SMTP, WhatsApp). **Leave empty on first run** — auto-generated to `.encryption-key`. Set the same value on every server sharing one database. |
| `CSRF_SECRET` | random hex | HMAC key for CSRF tokens. Auto-generated to `.csrf-secret` when empty. |
| `SEED_ADMIN_PASSWORD` | `Opal@2026` | Password for the seeded admin (seed run only). |
| `TRUST_PROXY` | `1` / `loopback` / `"10.0.0.1,10.0.0.2"` | Trust Express `X-Forwarded-*` headers (needed behind nginx/Cloudflare for correct rate-limit keys and `req.ip`). **Never enable when directly exposed** — it lets clients spoof IPs. |

```env
ENCRYPTION_KEY=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
TRUST_PROXY=1
```

## 3. Shopify

Stored **in the database** (encrypted) via *System → Connections* — env vars are
only a fallback:

| Variable | Example | Purpose |
|---|---|---|
| `SHOPIFY_STORE_URL` | `your-store` (or full `https://your-store.myshopify.com`) | Store identifier |
| `SHOPIFY_ACCESS_TOKEN` | `shpat_xxxxxxxxxxxxxxxx` | Custom-app Admin API token |
| `SHOPIFY_API_VERSION` | `2025-10` | Admin API version |
| `SHOPIFY_WEBHOOK_SECRET` | random hex | Verifies `/api/v1/webhooks/shopify` + Flow webhook HMAC |
| `PUBLIC_BASE_URL` | `https://erp.example.com` | When set, order/product/customer webhooks are **auto-registered** at startup to point here |
| `FRONTEND_ORIGIN` | `http://localhost:47195` | Allowed CORS origin (the desktop app default) |

**Steps:**

1. Shopify Admin → *Settings → Apps and sales channels → Develop apps → Create an app*.
2. *Configure Admin API scopes*: `read/write products, orders, customers, inventory`.
3. *API credentials → Install app* → copy the **Admin API access token** (shown once).
4. ERP → *System → Connections → Shopify*: paste store URL + token → **Test** → **Save**.
5. Optional (auto webhooks): set `PUBLIC_BASE_URL` so the ERP registers
   `orders/create`, `orders/cancelled`, `orders/fulfilled`, `products/update`,
   `customers/create` on boot.
6. Dev stores redact customer PII on the API — set up the
   [Flow webhook](shopify-flow-webhook.md) and/or order-email ingestion (§5) to
   recover name/address.

## 4. Notifications email (SMTP / Resend)

Used for backup emails, payment reminders, dues statements, daily summary,
low-stock alerts. Env fallbacks; live values editable in *System → Settings →
Notifications* (stored encrypted):

| Variable | Example | Purpose |
|---|---|---|
| `NOTIFICATION_SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `NOTIFICATION_SMTP_PORT` | `587` | SMTP port (587 STARTTLS / 465 SSL) |
| `EMAIL_FROM` | `Opal Line <no-reply@opalline.in>` | From header |
| `NOTIFICATION_EMAIL` | `owner@opalline.in` | Default recipient (backups, summaries) |
| `RESEND_API_KEY` | `re_xxxxxxxxx` | Use Resend API instead of SMTP when set |

**Gmail example:**

```env
NOTIFICATION_SMTP_HOST=smtp.gmail.com
NOTIFICATION_SMTP_PORT=587
EMAIL_FROM=Opal Line <no-reply@opalline.in>
NOTIFICATION_EMAIL=owner@opalline.in
```

Steps for Gmail: enable 2FA → create an **App Password** → store it as the SMTP
password in *Settings → Notifications* (or `.env`). Verify with the **Send test
email** button on that page.

## 5. Order email ingestion (PII recovery)

Shopify's owner **"New Order" notification email is never redacted** — point a
dedicated mailbox at it and the ERP polls every 2 minutes, merging full customer
name/phone/address into imported orders:

| Variable | Example | Purpose |
|---|---|---|
| `ORDER_EMAIL_ADDRESS` | `orders@yourdomain.com` | Mailbox that receives Shopify's new-order notification |
| `ORDER_EMAIL_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` | App password (Gmail) — values with the `encV1:` prefix are treated as already encrypted |
| `ORDER_EMAIL_HOST` | `imap.gmail.com` | IMAP server |
| `ORDER_EMAIL_PORT` | `993` | IMAP port |
| `ORDER_EMAIL_FOLDER` | `INBOX` | Folder to scan |
| `ORDER_EMAIL_PROVIDER` | `mailtm` | Use `mailtm` for a mail.tm REST mailbox, otherwise IMAP |

**Steps (Gmail):**

1. Create/choose a mailbox, e.g. `orders@yourdomain.com`.
2. Shopify Admin → *Settings → Notifications*: add that address as a **staff
   order notification** recipient.
3. Gmail: enable 2FA + IMAP (*Settings → Forwarding and POP/IMAP*), create an
   App Password.
4. `backend/.env`:
   ```env
   ORDER_EMAIL_ADDRESS=orders@yourdomain.com
   ORDER_EMAIL_PASSWORD=abcd-efgh-ijkl-mnop
   ORDER_EMAIL_HOST=imap.gmail.com
   ORDER_EMAIL_PORT=993
   ORDER_EMAIL_FOLDER=INBOX
   ```
5. Restart the backend. Check *Shopify → email ingest status* / the
   **Recover PII** button on the Customers page.

## 6. WhatsApp (Cloud API)

Sends invoice/order/shipping/payment-reminder messages:

| Variable | Example | Purpose |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | `EAAG…` | Meta WhatsApp Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | `123456789012345` | Phone number ID from the Meta dashboard |

Steps: Meta developers → WhatsApp product → copy token + phone number ID →
paste in *System → Connections* (encrypted, editable live) or `.env`. Verify
with *Settings → Test WhatsApp*.

## 7. Razorpay payment links

| Variable | Example | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_xxxxxxxx` | Key ID |
| `RAZORPAY_KEY_SECRET` | `xxxxxxxxxxxxxxxx` | Key secret |

Steps: Razorpay dashboard → *Settings → API keys → Generate test/live key* →
paste into `.env` (or the Connections UI). Used for payment links on invoices
and auto-reconciliation of Razorpay payments.

## 8. Backups

| Variable | Example | Purpose |
|---|---|---|
| `BACKUP_DIR` | `D:\opal-backups` | Overrides the default backup folder |
| `BACKUP_ENCRYPTION_KEY` | passphrase | Encrypts auto-backup archives when the encrypted toggle is on |
| `BACKUP_OFFSITE_*` | see below | Push the latest backup to any S3-compatible bucket after each auto-backup |

**Off-site (S3 / R2 / B2 example):**

```env
BACKUP_OFFSITE_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
BACKUP_OFFSITE_REGION=auto
BACKUP_OFFSITE_BUCKET=opal-backups
BACKUP_OFFSITE_KEY_ID=xxxxx
BACKUP_OFFSITE_SECRET=yyyyy
BACKUP_OFFSITE_PREFIX=opal-line
```

In-app toggles (*System → Backup & Restore*): auto-backup schedule (7:00 PM
IST), **encrypted archives**, **auto-email the archive** (≤20 MB attachment
budget), verify-all, cleanup keep-last-N. The daily summary + low-stock emails
reuse the notifications email (§4).

## 9. Silver rate pricing

| Variable | Example | Purpose |
|---|---|---|
| `SILVER_RATE_API_URL` | `https://api.example.com/xagusd` | Metal rate source (fallback: bundled fetchers) |
| `SILVER_RATE_API_KEY` | `key` | Bearer key for the rate API |
| `LOYALTY_ENABLED` | `true` | Turns the loyalty-points module on |

Rate lifecycle: *Silver Rate page* or the scheduler updates the rate → all
product selling prices recompute → matched Shopify variants get the new price
pushed → a sync-log entry records the change.

## 10. Paths, logging, uploads (desktop/embedded use)

| Variable | Example | Purpose |
|---|---|---|
| `APP_DATA_DIR` | `%APPDATA%\Opal Line Billing` | Desktop data root (database, env, keys) |
| `UPLOADS_DIR` | `D:\opal-uploads` | Where product images are written (default under app data) |
| `LOG_DIR` | `D:\opal-logs` | Log folder for the System Status log viewer |
| `LOG_LEVEL` | `debug` / `info` | pino level (dev default `debug`, prod `info`) |
| `APP_VERSION` | `1.0.7` | Shown on System Status |
| `DOTENV_CONFIG_PATH` | `D:\conf\opal.env` | Load `.env` from an explicit path |
| `FRONTEND_DIST` | `D:\opal\frontend-dist` | Serve the UI from an explicit folder |

## 11. Print Designer

No env vars — configured entirely in the UI (*System → Print Designer*):

1. Pick the doc tab: **Invoice / Quotation / Order / Packing slip / Pick list**.
2. Style it: header style, accent colours, fonts, page size, margins, zebra
   rows, logo, bank details, UPI QR, Packed-By/Checked-By signature lines.
3. **Save & set default** → applies to every future printout of that type.
4. **Export design** / **Import design** (`.opal-print.json`) to share designs
   or move them between machines; imports are validated server-side.

Invoices, quotations, orders, packing slips and pick lists print with product
photo thumbnails when images exist.

## 12. In-app Settings reference (*System → Settings*)

| Tab | Keys |
|---|---|
| Appearance | Theme: Light / Dark / System (also the 🌙 header toggle) |
| Business | Business name, GSTIN, phone, email, address; defaults: purity (92.5/95.8/99.9), making charge ₹/g, GST %, currency, invoice prefix, rate source (MCX), auto-update rate, require rate approval |
| Banking | Bank accounts used on prints |
| Silver Rate | Source + auto-update + approval toggle |
| Notifications | Low-stock alerts, daily summary, Shopify order-import notices, payment reminders, test senders |
| Team | Role permissions overview + **Security card → "Log out other devices"** |
| Users & Roles | Per-user module/action permissions, activation, password resets |

## 13. Rate limiting (operational notes)

- Login: 20 attempts / 15 min / IP; password reset: stricter; email endpoints:
  30/hour. Counters are **persisted in Postgres** (`rate_limit_hits`,
  `login_attempts`) and survive restarts.
- Behind a proxy, set `TRUST_PROXY` (§2) so per-IP limits see real client IPs.
- Dev tip — clear the budget after heavy testing:
  ```sql
  DELETE FROM rate_limit_hits;
  DELETE FROM login_attempts;
  ```
- E2E tests abort with a clear 429 message when the login budget is exhausted.

## 14. Quick-reference: full example `backend/.env`

```env
# ── Core ────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:S3cret@localhost:5432/opal_line
PORT=47191
NODE_ENV=development

# ── Security ────────────────────────────────────────────────────────────
ENCRYPTION_KEY=            # auto-generated on first run
CSRF_SECRET=               # auto-generated on first run
TRUST_PROXY=               # only behind a reverse proxy

# ── Shopify (or set in System → Connections) ────────────────────────────
# SHOPIFY_STORE_URL=your-store
# SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxx
# SHOPIFY_API_VERSION=2025-10
# SHOPIFY_WEBHOOK_SECRET=some-random-hex
PUBLIC_BASE_URL=           # https://erp.example.com → auto-registers webhooks

# ── Order email ingestion (dev-store PII recovery) ──────────────────────
# ORDER_EMAIL_ADDRESS=orders@yourdomain.com
# ORDER_EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx
# ORDER_EMAIL_HOST=imap.gmail.com
# ORDER_EMAIL_PORT=993
# ORDER_EMAIL_FOLDER=INBOX

# ── Notification email ──────────────────────────────────────────────────
NOTIFICATION_SMTP_HOST=smtp.gmail.com
NOTIFICATION_SMTP_PORT=587
EMAIL_FROM=Opal Line <no-reply@opalline.in>
NOTIFICATION_EMAIL=owner@opalline.in
# RESEND_API_KEY=re_xxxxxxxx

# ── WhatsApp Cloud API ──────────────────────────────────────────────────
# WHATSAPP_ACCESS_TOKEN=EAAG...
# WHATSAPP_PHONE_NUMBER_ID=123456789012345

# ── Razorpay ────────────────────────────────────────────────────────────
# RAZORPAY_KEY_ID=rzp_test_xxxx
# RAZORPAY_KEY_SECRET=xxxx

# ── Backups ─────────────────────────────────────────────────────────────
# BACKUP_DIR=D:\opal-backups
# BACKUP_OFFSITE_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
# BACKUP_OFFSITE_REGION=auto
# BACKUP_OFFSITE_BUCKET=opal-backups
# BACKUP_OFFSITE_KEY_ID=xxxxx
# BACKUP_OFFSITE_SECRET=yyyyy
# BACKUP_OFFSITE_PREFIX=opal-line

# ── Pricing ─────────────────────────────────────────────────────────────
# SILVER_RATE_API_URL=https://api.example.com/xagusd
# SILVER_RATE_API_KEY=xxxxx
# LOYALTY_ENABLED=true

# ── Logging / paths ─────────────────────────────────────────────────────
LOG_LEVEL=debug
# LOG_DIR=D:\opal-logs
# UPLOADS_DIR=D:\opal-uploads
```
