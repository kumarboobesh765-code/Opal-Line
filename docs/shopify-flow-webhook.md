# Shopify Flow webhook — auto-fill customer name & address on orders

## Why this exists

Shopify **dev / trial stores redact customer PII** (name, phone, full address) on
the Admin REST API unless the store's plan/API access includes it. Order sync
therefore imports orders with `customer = "Guest"`, only an email, and empty
billing/shipping addresses.

The ERP exposes an endpoint that Shopify Flow can call with the order's customer
details the moment an order is created — bypassing the API redaction entirely,
because Flow runs inside Shopify with full data access.

- **Endpoint:** `POST /api/v1/shopify/flow-webhook`
- **Auth:** HMAC-verified via `SHOPIFY_WEBHOOK_SECRET` (unauthenticated to
  browsers on purpose — Shopify servers call it with no session)
- **Effect:** updates the matching order (`customer`, `billingAddress`,
  `shippingAddress`) and upserts the customer record (matched by email/phone —
  never by name)

## One-time setup in Shopify

1. **Create the workflow** — in Shopify Admin open **Flow** (Settings → Apps →
   Flow, or admin.shopify.com → Flow) and create a new workflow.

2. **Trigger:** *Order created*.

3. **Action:** *Send HTTP request*
   - Method: `POST`
   - URL: `https://<your-erp-host>/api/v1/shopify/flow-webhook`
     (for a local dev machine use a tunnel, e.g.
     `ngrok http 47191` → `https://xxxx.ngrok.app/api/v1/shopify/flow-webhook`)
   - Headers:
     - `Content-Type: application/json`
     - `X-Shopify-Hmac-Sha256`: Flow cannot compute HMACs, so either leave the
       secret unset in the ERP for local testing (the request is then accepted
       with a logged warning) **or** put the shared secret in a custom header
       and verify at your tunnel/proxy. Real deployments should terminate TLS
       behind a proxy that verifies the signature.
   - Body (JSON — Flow template variables):

```json
{
  "order_name": "{{ order.name }}",
  "customer_first_name": "{{ order.customer.firstName }}",
  "customer_last_name": "{{ order.customer.lastName }}",
  "customer_email": "{{ order.email }}",
  "customer_phone": "{{ order.phone }}",
  "billing_address1": "{{ order.billingAddress.address1 }}",
  "billing_address2": "{{ order.billingAddress.address2 }}",
  "billing_city": "{{ order.billingAddress.city }}",
  "billing_province": "{{ order.billingAddress.province }}",
  "billing_zip": "{{ order.billingAddress.zip }}",
  "billing_country": "{{ order.billingAddress.country }}",
  "shipping_address1": "{{ order.shippingAddress.address1 }}",
  "shipping_address2": "{{ order.shippingAddress.address2 }}",
  "shipping_city": "{{ order.shippingAddress.city }}",
  "shipping_province": "{{ order.shippingAddress.province }}",
  "shipping_zip": "{{ order.shippingAddress.zip }}",
  "shipping_country": "{{ order.shippingAddress.country }}"
}
```

4. **Set the secret in the ERP** (recommended for always-on deployments):
   `SHOPIFY_WEBHOOK_SECRET=<random hex>` in the backend `.env`. When set, the
   endpoint **requires** a valid HMAC header; when unset it logs a warning and
   accepts the payload (dev-friendly, not for production).

5. **Test:** place a test order on the store. Within seconds the ERP log shows
   `Flow webhook processed`, and the Sales Orders page shows the real customer
   name and address for that order. Older orders keep being repaired by the
   **Repair customer info** button / PII recovery tools.

## Payload contract (implemented in `backend/src/index.ts`)

| Field | Required | Notes |
|---|---|---|
| `order_name` | yes | matches `sales_orders.shopify_id` (e.g. `#1030`) |
| `customer_first_name` / `customer_last_name` | no | joined into the display name |
| `customer_email` | no | validated as email; upsert key for the customer |
| `customer_phone` | no | upsert key for the customer (≤15 digits) |
| `billing_*` / `shipping_*` | no | any of address1/city present → address block saved |

The handler never creates orders — it only enriches existing ones. Unknown
order names are ignored (update matches zero rows). Responses: `200 {ok:true}`,
`400` for a missing/invalid payload, `401` on HMAC mismatch, `503` when the
database is down.
