import { useMemo } from 'react'
import { Package } from 'lucide-react'
import type { ColumnDef } from '@/components/ui/data-table'
import { ShopifySyncPage } from '@/components/shopify/sync-page'
import { Badge } from '@/components/ui/badge'
import { shopifyApi } from '@/lib/api'
import type { SyncProduct } from '@/types/shopify'
import { formatCurrency } from '@/lib/format'

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  active: { label: 'Active', variant: 'success' },
  archived: { label: 'Archived', variant: 'muted' },
  draft: { label: 'Draft', variant: 'warning' },
}

export default function ShopifyProductsPage() {
  const columns = useMemo<ColumnDef<SyncProduct>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Product',
        meta: { headerClassName: 'min-w-[220px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <Package className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{row.original.title}</p>
              <p className="text-[11px] text-muted-foreground">{row.original.collection || row.original.productType || '—'}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'sku',
        header: 'SKU',
        cell: ({ row }) => (
          <span className="font-mono text-[12.5px] text-muted-foreground">{row.original.sku || '—'}</span>
        ),
      },
      {
        accessorKey: 'vendor',
        header: 'Vendor',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.vendor || '—'}</span>,
      },
      {
        accessorKey: 'collection',
        header: 'Collection',
        cell: ({ row }) => (
          <span className="font-medium">{row.original.collection || '—'}</span>
        ),
      },
      {
        accessorKey: 'productType',
        header: 'Type',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.productType || '—'}</span>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Price',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(row.original.price))}</span>,
      },
      {
        id: 'compare',
        header: 'Compare At',
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.compareAtPrice ? formatCurrency(Number(row.original.compareAtPrice)) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'inventoryQuantity',
        header: 'Stock',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.inventoryQuantity}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const b = statusBadge[row.original.status] ?? { label: row.original.status, variant: 'muted' as const }
          return <Badge variant={b.variant} dot>{b.label}</Badge>
        },
      },
    ],
    [],
  )

  return (
    <ShopifySyncPage
      title="Products Sync"
      subtitle="Catalog products pulled from Shopify with variant, price and stock snapshot."
      resourceLabel="Products"
      resource="products"
      icon={Package}
      loader={shopifyApi.getProducts}
      columns={columns}
      searchPlaceholder="Search product, SKU, vendor..."
      emptyDescription="Products pulled from your Shopify store will appear here after the first sync."
    />
  )
}
