// Local-DB image-ref audit: histogram of images[] length per product, count of
// refs that are not Shopify CDN URLs, and any data:-URL refs (image bytes in DB).
import { db, schema } from '../src/db/client'

async function main() {
  if (!db) { console.log('NO_DB'); process.exit(1) }
  const rows = await db
    .select({ image: schema.products.image, images: schema.products.images })
    .from(schema.products)
  const hist: Record<number, number> = {}
  let nonCdn = 0
  let dataUrl = 0
  for (const r of rows) {
    const len = Array.isArray(r.images) ? r.images.length : 0
    hist[len] = (hist[len] ?? 0) + 1
    const all = [r.image, ...(Array.isArray(r.images) ? (r.images as string[]) : [])].filter(Boolean) as string[]
    for (const s of all) {
      if (!s.includes('cdn.shopify.com')) nonCdn++
      if (s.startsWith('data:')) dataUrl++
    }
  }
  console.log(
    `RESULT total=${rows.length} hist=${JSON.stringify(hist)} nonCdnRefs=${nonCdn} dataUrlRefs=${dataUrl}`,
  )
}

main().then(() => process.exit(0)).catch((e) => { console.error('ERR ' + e.message); process.exit(1) })