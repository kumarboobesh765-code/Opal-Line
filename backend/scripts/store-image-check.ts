// Store-side verification: every product has exactly one image after the
// double-push (idempotency proof — no duplicates, nothing deleted).
import { config } from '../src/config'

async function gql(query: string, variables: Record<string, unknown>) {
  const res = await fetch(`https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': config.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return (await res.json()) as {
    data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ id: string; title: string; mediaCount?: { count: number } }> } }
    errors?: unknown[]
  }
}

async function main() {
  let cursor: string | null = null
  let total = 0
  let withImg = 0
  const hist: Record<number, number> = {}
  const multi: string[] = []
  for (let page = 0; page < 10; page++) {
    const r = await gql(
      `query ($c: String) { products(first: 50, after: $c) { pageInfo { hasNextPage endCursor } nodes { id title mediaCount { count } } } }`,
      { c: cursor },
    )
    const d = r.data?.products
    if (!d) { console.log('ERR', JSON.stringify(r.errors ?? r).slice(0, 300)); process.exit(1) }
    for (const n of d.nodes) {
      total++
      const c = n.mediaCount?.count ?? 0
      if (c > 0) withImg++
      hist[c] = (hist[c] ?? 0) + 1
      if (c !== 1) multi.push(`x${c} ${n.title.slice(0, 45)}`)
    }
    if (!d.pageInfo.hasNextPage) break
    cursor = d.pageInfo.endCursor
  }
  console.log(JSON.stringify({ storeTotal: total, withImage: withImg, imageCountHistogram: hist, notExactlyOne: multi }, null, 2))
}

main().catch((e) => { console.error('FAIL:', e?.cause ?? e?.message ?? e); process.exit(1) })
