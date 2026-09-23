// Store-vs-local photo match: for every listed product, the local row's image
// ref must be the SAME Shopify CDN file as the listing's first image
// (pathname compare — querystrings like ?v=… are ignored). Includes legacy
// short-id products like `007`.
import { config } from '../src/config'
import { db, schema } from '../src/db/client'

function pathnameOf(src: string | null | undefined): string {
  if (!src) return ''
  try { return new URL(src).pathname } catch { return src.split('?')[0] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!db) { console.log('NO_DB'); process.exit(1) }
  const rows = await db
    .select({ id: schema.products.id, sku: schema.products.sku, shopifyId: schema.products.shopifyId, image: schema.products.image, images: schema.products.images })
    .from(schema.products)
  const listed = rows.filter((r) => r.shopifyId && Number(String(r.shopifyId).replace(/^#/, '')) > 0)

  let match = 0
  const mismatches: string[] = []
  for (const row of listed) {
    const pid = Number(String(row.shopifyId).replace(/^#/, ''))
    let first = ''
    for (let a = 0; a < 3; a++) {
      if (a) await sleep(500 * a)
      try {
        const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/products/${pid}`, {
          headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
        })
        if (res.ok) {
          const json = (await res.json()) as { product?: { images?: Array<{ src?: string }> } }
          first = json.product?.images?.[0]?.src ?? ''
          break
        }
        if (res.status !== 429 && res.status < 500) break
      } catch { /* retry */ }
    }
    const ok = first !== '' && pathnameOf(first) === pathnameOf(row.image)
    if (ok) match++
    else mismatches.push(`${row.sku}: store=${pathnameOf(first).slice(-40)} local=${pathnameOf(row.image).slice(-40)}`)
    await sleep(250)
  }
  console.log(`RESULT listed=${listed.length} match=${match} mismatch=${mismatches.length}`)
  if (mismatches.length) console.log(mismatches.join('\n'))
  process.exit(mismatches.length ? 1 : 0)
}

main().catch((e) => { console.error('ERR ' + (e?.message ?? e)); process.exit(1) })