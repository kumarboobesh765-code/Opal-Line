// Prints alt + src of listing images whose alt does not resolve to a local
// uploads file (the "unknown" class in repair-listing-images) so we can eyeball
// what would be deleted before the irreversible repair run.
import { eq, inArray } from 'drizzle-orm'
import { config } from '../src/config'
import { db, schema } from '../src/db/client'

const SKUS = ['qw', 'IMG-1788767720800', 'rggregre', 'asdfghj']

async function main() {
  if (!db) { console.error('no db'); process.exit(1) }
  const rows = await db
    .select({ sku: schema.products.sku, shopifyId: schema.products.shopifyId })
    .from(schema.products)
    .where(inArray(schema.products.sku, SKUS))
  for (const row of rows) {
    const pid = Number(String(row.shopifyId ?? '').replace(/^#/, ''))
    if (!pid) { console.log(`${row.sku}: no shopifyId`); continue }
    const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/products/${pid}`, {
      headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
    })
    const json = (await res.json()) as { product?: { images?: Array<{ id?: number; alt?: string | null; src?: string }> } }
    console.log(`\n${row.sku} (${pid}):`)
    for (const img of json.product?.images ?? []) {
      console.log(`  alt=${JSON.stringify(img.alt)} src=...${(img.src ?? '').slice(-70)}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e); process.exit(1) })