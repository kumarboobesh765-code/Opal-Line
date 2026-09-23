// One-off: check/delete a Shopify product directly. Usage:
//   npx tsx scripts/shopify-product-check.ts get <id>
//   npx tsx scripts/shopify-product-check.ts delete <id>
import { config } from '../src/config'

async function main() {
  const [, , verb, idArg] = process.argv
  const id = Number(idArg)
  if (!id || !['get', 'delete'].includes(verb ?? '')) {
    console.error('usage: npx tsx scripts/shopify-product-check.ts <get|delete> <id>')
    process.exit(1)
  }
  const method = verb === 'delete' ? 'DELETE' : 'GET'
  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/products/${id}.json`
  const res = await fetch(url, {
    method,
    headers: { 'X-Shopify-Access-Token': config.accessToken, Accept: 'application/json' },
  })
  console.log(`${method} products/${id}: HTTP ${res.status}`)
  if (verb === 'get' && res.ok) {
    const body: any = await res.json()
    console.log('title:', body.product?.title, '| images:', body.product?.images?.length ?? 0)
  }
  process.exit(0)
}
void main()
