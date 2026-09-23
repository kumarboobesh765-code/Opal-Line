// Idempotency proof: push every listed product once more, then re-audit the
// store. Before the fix this re-added placeholder cards (poisoned local rows +
// fire-and-forget deletes). Now it must be a strict no-op: still 65x1 images.
import { eq, isNotNull } from 'drizzle-orm'
import { db, schema } from '../src/db/client'
import { pushProductsToShopify } from '../src/shopify'
import { config } from '../src/config'

async function storeHist(): Promise<{ total: number; hist: Record<number, number>; multi: string[] }> {
  let cursor: string | null = null
  let total = 0
  const hist: Record<number, number> = {}
  const multi: string[] = []
  for (let page = 0; page < 10; page++) {
    const res = await fetch(
      `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': config.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query ($c: String) { products(first: 50, after: $c) { pageInfo { hasNextPage endCursor } nodes { id title mediaCount { count } } } }`,
          variables: { c: cursor },
        }),
      },
    )
    const json = (await res.json()) as {
      data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ id: string; title: string; mediaCount?: { count: number } }> } }
      errors?: unknown[]
    }
    const d = json.data?.products
    if (!d) throw new Error('gql failed: ' + JSON.stringify(json.errors ?? json).slice(0, 300))
    for (const n of d.nodes) {
      total++
      const c = n.mediaCount?.count ?? 0
      hist[c] = (hist[c] ?? 0) + 1
      if (c !== 1) multi.push(`x${c} ${n.title.slice(0, 40)}`)
    }
    if (!d.pageInfo.hasNextPage) break
    cursor = d.pageInfo.endCursor
  }
  return { total, hist, multi }
}

async function main() {
  if (!db) { console.log('NO_DB'); process.exit(1) }
  const rows = await db
    .select({ id: schema.products.id, sku: schema.products.sku, image: schema.products.image, images: schema.products.images })
    .from(schema.products)
    .where(isNotNull(schema.products.shopifyId))
  const localBefore = rows.map((r) => `${r.sku}|${r.image}|${JSON.stringify(r.images)}`)

  const before = await storeHist()
  console.log(`STORE BEFORE: total=${before.total} hist=${JSON.stringify(before.hist)} multi=${JSON.stringify(before.multi)}`)

  const ids = rows.map((r) => r.id)
  const res = await pushProductsToShopify(ids)
  console.log(
    `PUSH: ok=${res.ok} created=${res.created} updated=${res.updated} skipped=${res.skipped} errors=${res.errors.length}`,
  )
  if (res.errors.length) console.log('PUSH ERRORS: ' + JSON.stringify(res.errors.slice(0, 5)))

  const after = await storeHist()
  console.log(`STORE AFTER:  total=${after.total} hist=${JSON.stringify(after.hist)} multi=${JSON.stringify(after.multi)}`)

  const rowsAfter = await db
    .select({ id: schema.products.id, sku: schema.products.sku, image: schema.products.image, images: schema.products.images })
    .from(schema.products)
    .where(isNotNull(schema.products.shopifyId))
  const localAfter = rowsAfter.map((r) => `${r.sku}|${r.image}|${JSON.stringify(r.images)}`)
  const localDiffs = localBefore.filter((s, i) => s !== localAfter[i])
  console.log(`LOCAL ROWS CHANGED: ${localDiffs.length}`)
  if (localDiffs.length) console.log(localDiffs.slice(0, 5).join('\n'))

  const pass =
    after.total === before.total &&
    JSON.stringify(after.hist) === JSON.stringify(before.hist) &&
    after.hist['1'] === after.total &&
    localDiffs.length === 0
  console.log(pass ? 'IDEMPOTENT PASS: re-push was a strict no-op' : 'IDEMPOTENT FAIL: state drifted')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('ERR ' + (e?.message ?? e)); process.exit(1) })