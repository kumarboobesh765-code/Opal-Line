# Opal Line ERP — Deployment Guide

## Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- **PostgreSQL** 14+ (tested with 17)
- **npm** 9+ (or pnpm/yarn)
- **Shopify** store with Admin API access token

## 1. Environment Setup

### Backend `.env`

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Server
PORT=4000

# Database
DATABASE_URL=postgresql://postgres:REDACTED@localhost:5432/opal_line

# Encryption (auto-generated on first run if empty)
ENCRYPTION_KEY=

# Shopify
SHOPIFY_STORE_URL=https://your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
SHOPIFY_API_VERSION=2024-10

# Backup
BACKUP_DIR=./backups

# Email notifications (optional — Resend.com)
RESEND_API_KEY=re_xxxxxxxxxxxxx
NOTIFICATION_EMAIL=alerts@yourdomain.com
EMAIL_FROM=Opal Line <notifications@yourdomain.com>

# Silver rate API (optional)
SILVER_RATE_API_URL=https://api.metals.dev/v1/latest?api_key=YOUR_KEY
SILVER_RATE_API_KEY=
```

### Frontend `.env`

```env
VITE_API_BASE=http://localhost:4000/api/v1
```

## 2. Database Setup

```bash
# Create database
createdb opal_line

# Run migrations
cd backend
npx drizzle-kit push

# Seed initial data (creates admin user + sample data)
npx tsx src/db/seed.ts
```

**First login credentials** (from seed output — check console):
- Username: `arjun`
- Password: printed in console on first seed, or set via `SEED_ADMIN_PASSWORD=yourpass npx tsx src/db/seed.ts`

## 3. Start Development

```bash
# From project root (starts both backend + frontend)
npm run dev

# Or separately:
cd backend && npm run dev   # :4000
cd frontend && npm run dev  # :5173
```

## 4. Production Build

### Backend

The backend runs directly with `tsx` or can be compiled:

```bash
cd backend
npx tsc --noEmit  # Type check
node --import tsx src/index.ts  # Or use pm2/nodemon
```

### Frontend

```bash
cd frontend
npm run build     # Outputs to frontend/dist/
npm run preview   # Preview production build
```

### Serve Frontend

For production, serve `frontend/dist/` with nginx or a CDN:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        root /path/to/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 5. Process Management (PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Start backend
cd backend
pm2 start "node --import tsx src/index.ts" --name opal-backend

# Save process list
pm2 save
pm2 startup
```

## 6. SSL/HTTPS

Use Certbot with nginx:

```bash
sudo certbot --nginx -d yourdomain.com
```

## 7. Shopify Webhook Setup

1. Go to **Shopify Admin → Settings → Notifications → Webhooks**
2. Create webhooks for:
   - `orders/create` → `https://yourdomain.com/api/v1/webhooks/orders/create`
   - `orders/updated` → `https://yourdomain.com/api/v1/webhooks/orders/updated`
   - `orders/cancelled` → `https://yourdomain.com/api/v1/webhooks/orders/cancelled`
   - `products/create` → `https://yourdomain.com/api/v1/webhooks/products/create`
   - `products/update` → `https://yourdomain.com/api/v1/webhooks/products/update`
3. Set the webhook secret in `.env` as `SHOPIFY_WEBHOOK_SECRET`

## 8. Backups

### Auto-Backup

Runs daily at **7:00 PM IST** (configurable in `backend/src/autoBackup.ts`):
- Full backup of all tables
- Auto-prunes to keep last 15 backups
- Pre-restore safety backups auto-deleted after 7 days

### Manual Backup

Via API:
```bash
# Export full backup
curl -H "Cookie: session=xxx" http://localhost:4000/api/v1/backup/export?type=full

# Export encrypted
curl -H "Cookie: session=xxx" http://localhost:4000/api/v1/backup/export-encrypted?type=full
```

Via UI: **Settings → Backup & Restore → Full Backup**

## 9. Email Notifications

Requires a [Resend](https://resend.com) account (free tier: 100 emails/day):

1. Sign up at resend.com
2. Get your API key
3. Add to `.env`:
   ```
   RESEND_API_KEY=re_xxxxx
   NOTIFICATION_EMAIL=you@yourdomain.com
   ```
4. Test: **Backup & Restore → Email Notifications → Send Test Email**

### Automatic Notifications

- **Backup complete**: Sent after each daily auto-backup
- **Low stock alert**: Sent when products fall below reorder level
- **Daily summary**: Available via API or UI button

## 10. Monitoring

### Health Check

```bash
curl http://localhost:4000/api/v1/health
```

### Logs

```bash
# PM2 logs
pm2 logs opal-backend

# Or tail the log file
tail -f backend-run.log
```

### Activity Trail

All user actions are logged in `activity_logs`:
- Login/logout
- CRUD operations
- Backup/restore
- Shopify sync

## 11. Security Checklist

- [ ] Change default admin password
- [ ] Set strong `ENCRYPTION_KEY` (auto-generated if empty)
- [ ] Use HTTPS in production
- [ ] Set `SHOPIFY_WEBHOOK_SECRET` for webhook verification
- [ ] Restrict database access to localhost only
- [ ] Enable rate limiting (built-in on auth endpoints)
- [ ] Review RBAC roles and permissions
- [ ] Set `NOTIFICATION_EMAIL` for alerts

## 12. Troubleshooting

| Issue | Solution |
|---|---|
| `password authentication failed` | Check `DATABASE_URL` password matches PostgreSQL |
| `EADDRINUSE: port 4000` | Kill existing process: `taskkill /PID <pid> /F` |
| Shopify sync fails | Check `SHOPIFY_ACCESS_TOKEN` and store URL |
| Email not sending | Verify `RESEND_API_KEY` and check spam folder |
| Backup restore fails | Ensure backup file is valid JSON, check disk space |
| Silver rate not updating | Set `SILVER_RATE_API_URL` in `.env` |

## 13. Windows Desktop Releases (signed installer)

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed
to the **Opal-Line** repo:

```bash
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2
```

The workflow lints/tests, imports the code-signing cert, builds the NSIS
installer (frontend + bundled backend + portable PostgreSQL), verifies the
Authenticode signature, and attaches `Opal.Line.Billing-Setup-<ver>.exe` +
`.blockmap` to a GitHub Release. Builds take ~20-25 min.

### One-time setup: signing certificate

The installer must be signed with a cert whose subject contains
`Opal Line Billing` (enforced by `signtoolOptions` in
`electron/electron-builder.yml`; a missing cert fails the build). From the
machine that has the cert:

```powershell
Export-PfxCertificate -Cert Cert:\CurrentUser\My\<thumbprint> `
  -FilePath code-signing.pfx -Password (ConvertTo-SecureString '' -AsPlainText -Force)
# Set the repo secret (uses scripts/set-gh-secret.mjs when gh CLI is absent):
GH_TOKEN=<token> node scripts/set-gh-secret.mjs WIN_SIGNING_PFX_B64 \
  <(base64 -w0 code-signing.pfx)
```

### Hard-won gotchas

- **Never import the cert into `Cert:\CurrentUser\Root` on the runner.** Both
  `Import-Certificate` and `certutil -user -addstore Root` raise a
  confirmation dialog that nobody can click on a headless runner — the job
  hangs silently. The workflow uses the **machine** Root/TrustedPublisher
  stores (`certutil -f -addstore`), which never prompt because GH runners are
  elevated.
- The job has `timeout-minutes: 90` so any hang fails fast instead of
  burning GitHub's 6-hour default.
- `publish: null` in electron-builder.yml stops electron-builder from trying
  to auto-publish (it fails without a `GH_TOKEN`); the workflow attaches
  assets to the Release itself.

### Verify a release locally

```powershell
# Download the asset from the GitHub Release, then:
Get-AuthenticodeSignature .\Opal.Line.Billing-Setup-1.0.1.exe
# Status should be Valid (or NotTrusted with our thumbprint — intact signature)

# Full smoke test (silent install + boot check of PostgreSQL & API):
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/smoke-test-install.ps1 -SetupPath .\Opal.Line.Billing-Setup-1.0.1.exe
```

### Local installer build (no CI)

```bash
npm run electron:build   # outputs dist-electron/*Setup-*.exe
```

## Architecture

```
opal_line/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express server, route mounting
│   │   ├── routes/
│   │   │   ├── auth.ts       # Login, logout, password reset
│   │   │   ├── db.ts         # Generic CRUD for all entities
│   │   │   ├── backup.ts     # Backup/restore/export/cleanup
│   │   │   ├── dashboard.ts  # KPIs, charts, analytics
│   │   │   ├── rbac.ts       # Role-based access control
│   │   │   └── dashboard.ts  # Profit analytics, reports
│   │   ├── shopify.ts        # Shopify sync engine
│   │   ├── autoBackup.ts     # Daily backup scheduler
│   │   ├── silverRateScheduler.ts  # Silver rate auto-update
│   │   ├── notifications.ts  # Email via Resend
│   │   ├── sessions.ts       # Session management
│   │   ├── rbac.ts           # Permission engine
│   │   └── db/
│   │       ├── schema.ts     # Drizzle ORM schema
│   │       ├── client.ts     # Database connection
│   │       └── seed.ts       # Initial data seeder
│   └── backups/              # Backup files (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/            # All UI pages
│   │   ├── components/       # Shared components
│   │   ├── lib/api.ts        # API client
│   │   └── auth/             # Auth context
│   └── dist/                 # Production build output
└── playwright-audit.mjs      # E2E security tests
```
