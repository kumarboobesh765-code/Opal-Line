# OPAL LINE Project

Billing software frontend (`frontend/`) + Shopify sync backend (`backend/`), in separate folders.

## Structure

```
frontend/   React + Vite + Tailwind web app (billing software UI)
backend/    Express + Drizzle + PostgreSQL API, Shopify sync, silver rate pricing
```

## Getting started

```bash
npm install          # installs both workspaces (hoisted to root node_modules)
npm run dev          # starts backend (port 4000) + frontend (port 5173) together
```

Or run them separately:

```bash
npm run dev:server   # backend only
npm run dev:web      # frontend only
```

## Backend setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Fill in `DATABASE_URL` and the Shopify credentials (`SHOPIFY_STORE_URL`, `SHOPIFY_ACCESS_TOKEN`).
3. Push the schema and seed the database:

```bash
npm run db:push
npm run db:seed
```

## Common tasks

```bash
npm run build        # typecheck + build the frontend
npm run lint         # lint the frontend
npm run typecheck    # typecheck the backend
npm run start:server # run the backend without watch mode
```

## Silver rate → Shopify price sync

The billing software stores the live silver rate. When the rate changes:

1. Backend recomputes every product's selling price (`(silver rate + making charge) × weight`, plus 3% GST).
2. Products are matched against the Shopify catalog (by SKU / barcode / title).
3. Matched products get their Shopify variant price pushed to the billing-software price.
4. A price-sync log is written so the change is traceable.

New products created in the billing software can be pushed to Shopify from the Shopify product tools.
