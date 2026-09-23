// One-off cleanup: delete a leftover test listing from the Shopify store using
// the backend's own battle-tested request path (proxy/TLS handled identically).
// Usage: npx tsx scripts/delete-listing.ts <shopifyNumericId>
import { deleteShopifyProduct } from '../src/shopify'

async function main() {
  const id = Number(process.argv[2])
  if (!id || Number.isNaN(id)) {
    console.error('usage: npx tsx scripts/delete-listing.ts <shopifyNumericId>')
    process.exit(1)
  }
  try {
    await deleteShopifyProduct(id)
    console.log(`DELETE products/${id}: OK (deleted or already gone)`)
    process.exit(0)
  } catch (err) {
    console.error('DELETE failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
void main()
