// One-off repair (Sep 23): every Shopify listing should carry exactly the
// stock photo. Earlier pushes left placeholder cards + stale test images on
// the listings because DELETE failures were swallowed and the write-back
// recorded the pre-delete snapshot. This script:
//   1. reads each listing (REST GET products/:id)
//   2. keeps the image whose alt resolves to a stock photo on disk
//   3. deletes every other image (status-verified + retried, paced for rate limits)
//   4. points the local row at the surviving CDN URL only
// Dry run: DRY_RUN=1 reports without writing anything.
// Re-runnable: already-repaired rows are a no-op (idempotent).
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { config } from '../src/config'
import { db, schema } from '../src/db/client'
import { deleteShopifyImageWithRetry } from '../src/shopify'
import { UPLOADS_DIR } from '../src/uploads'

const DRY = process.env.DRY_RUN === '1'
const STOCK_SINCE = new Date('2026-09-23 12:30:00').getTime()
const PH_START = new Date('2026-09-23 10:00:00').getTime()
const PH_END = new Date('2026-09-23 11:15:00').getTime()

/** Classify a listing image by the local file its alt marker points at. */
function kind(alt: string | null | undefined): string {
  if (!alt) return 'unknown'
  const f = path.join(UPLOADS_DIR(), path.basename(alt))
  let m = 0
  try { m = fs.statSync(f).mtimeMs } catch { return 'unknown' }
  if (m >= STOCK_SINCE) return 'stock'
  if (m >= PH_START && m < PH_END) return 'placeholder'
  return 'stale' // pre-placeholder test upload (or gap-window file)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getProduct(pid: number) {
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(500 * a)
    try {
      const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/products/${pid}`, {
        headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
      })
      if (res.ok) {
        return (await res.json()) as { product?: { images?: Array<{ id?: number; alt?: string | null; src?: string }> } }
      }
      if (res.status === 404) return null
      if (res.status !== 429 && res.status < 500) return null
    } catch { /* retry */ }
  }
  return 'error'
}

async function main() {
  if (!db) { console.error('no db'); process.exit(1) }
  const rows = await db
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      shopifyId: schema.products.shopifyId,
      image: schema.products.image,
      images: schema.products.images,
    })
    .from(schema.products)
  const listed = rows.filter((r) => r.shopifyId && Number(String(r.shopifyId).replace(/^#/, '')) > 0)
  console.log(`products=${rows.length} listed=${listed.length} ${DRY ? '(DRY RUN)' : ''}`)

  let deleted = 0
  let rowsFixed = 0
  let noStock = 0
  let errs = 0
  const notes: string[] = []

  for (const row of listed) {
    const pid = Number(String(row.shopifyId).replace(/^#/, ''))
    const got = await getProduct(pid)
    if (got === null || got === 'error') {
      errs++
      notes.push(`${row.sku}: GET listing ${pid} -> ${got}`)
      continue
    }
    const imgs = (got.product?.images ?? []).filter((i) => i.id && i.src)
    const stock = imgs.find((i) => kind(i.alt) === 'stock')
    const others = imgs.filter((i) => i !== stock)
    const kinds = imgs.map((i) => kind(i.alt)).join(',') || 'empty'

    if (!stock) {
      // Never strip a listing we can't positively identify the stock photo on.
      noStock++
      notes.push(`${row.sku}: NO stock image (kinds=${kinds}) — left untouched`)
      continue
    }

    let removed = 0
    if (!DRY) {
      for (const img of others) {
        const ok = await deleteShopifyImageWithRetry(pid, img.id!)
        if (ok) { removed++; deleted++ } else notes.push(`${row.sku}: delete image ${img.id} FAILED`)
        await sleep(400)
      }
      const [cur] = await db
        .select({ image: schema.products.image, images: schema.products.images })
        .from(schema.products)
        .where(eq(schema.products.id, row.id))
        .limit(1)
      const curImgs = Array.isArray(cur?.images) ? (cur.images as string[]) : []
      if (cur?.image !== stock.src || curImgs.length !== 1 || curImgs[0] !== stock.src) {
        await db
          .update(schema.products)
          .set({ image: stock.src!, images: [stock.src!] })
          .where(eq(schema.products.id, row.id))
        rowsFixed++
      }
    }

    console.log(
      `${row.sku}: keep=stock others=${others.length} kinds=[${kinds}]` +
        (DRY ? '' : ` removed=${removed}`),
    )
    await sleep(250)
  }

  console.log(
    `\n${DRY ? 'DRY-RUN ' : ''}done: listings=${listed.length} deleted=${deleted} rowsFixed=${rowsFixed} noStock=${noStock} errors=${errs}`,
  )
  if (notes.length) console.log('notes:\n' + notes.join('\n'))
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAIL', e); process.exit(1) })