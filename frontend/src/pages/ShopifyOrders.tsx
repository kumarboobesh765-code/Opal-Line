import { useMemo } from 'react'
import { ShoppingBag } from 'lucide-react'
import type { ColumnDef } from '@/components/ui/data-table'
import { ShopifySyncPage } from '@/components/shopify/sync-page'
import { Badge } from '@/components/ui/badge'
import { shopifyApi } from '@/lib/api'
import type { SyncOrder } from '@/types/shopify'
import { formatCurrency, formatDateTime } from '@/lib/format'

const financialBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }> = {
  paid: { label: 'Paid', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  partially_refunded: { label: 'Partial Refund', variant: 'warning' },
  refunded: { label: 'Refunded', variant: 'muted' },
  voided: { label: 'Voided', variant: 'danger' },
}

const fulfillmentBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'muted' }> = {
  fulfilled: { label: 'Fulfilled', variant: 'success' },
  partial: { label: 'Partial', variant: 'info' },
  unfulfilled: { label: 'Unfulfilled', variant: 'warning' },
}

export default function ShopifyOrdersPage() {
  const columns = useMemo<ColumnDef<SyncOrder>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Order',
        meta: { headerClassName: 'min-w-[110px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div>
              <p className="font-mono text-[13px] font-medium text-foreground">{row.original.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatDateTime(row.original.createdAt)}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-foreground">{row.original.customerName}</p>
            {row.original.email ? <p className="text-[11px] text-muted-foreground">{row.original.email}</p> : null}
          </div>
        ),
      },
      {
        accessorKey: 'totalPrice',
        header: 'Total',
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-foreground">
            {formatCurrency(Number(row.original.totalPrice))}
          </span>
        ),
      },
      {
        id: 'payment',
        header: 'Payment',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const b = financialBadge[row.original.financialStatus] ?? { label: row.original.financialStatus, variant: 'muted' as const }
          return <Badge variant={b.variant} dot>{b.label}</Badge>
        },
      },
      {
        id: 'fulfillment',
        header: 'Fulfillment',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const f = row.original.fulfillmentStatus
          const b = f ? fulfillmentBadge[f] : null
          return b ? <Badge variant={b.variant}>{b.label}</Badge> : <Badge variant="muted">—</Badge>
        },
      },
      {
        accessorKey: 'lineItems',
        header: 'Items',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.lineItems}</span>,
      },
      {
        accessorKey: 'currency',
        header: 'Currency',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.currency}</span>,
      },
    ],
    [],
  )

  return (
    <ShopifySyncPage
      title="Orders Sync"
      subtitle="Orders imported from Shopify, ready to be reconciled with invoices and Razorpay payments."
      resourceLabel="Orders"
      resource="orders"
      icon={ShoppingBag}
      loader={shopifyApi.getOrders}
      columns={columns}
      searchPlaceholder="Search order, customer, email..."
      emptyDescription="Orders pulled from your Shopify store will appear here after the first sync."
    />
  )
}
