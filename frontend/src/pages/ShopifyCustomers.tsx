import { useMemo } from 'react'
import { Users } from 'lucide-react'
import type { ColumnDef } from '@/components/ui/data-table'
import { ShopifySyncPage } from '@/components/shopify/sync-page'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { shopifyApi } from '@/lib/api'
import type { SyncCustomer } from '@/types/shopify'
import { formatCurrency, formatDateTime } from '@/lib/format'

export default function ShopifyCustomersPage() {
  const columns = useMemo<ColumnDef<SyncCustomer>[]>(
    () => [
      {
        accessorKey: 'firstName',
        header: 'Customer',
        meta: { headerClassName: 'min-w-[200px]' },
        cell: ({ row }) => {
          const initials = `${row.original.firstName?.[0] ?? ''}${row.original.lastName?.[0] ?? ''}`.toUpperCase() || '?'
          return (
            <div className="flex items-center gap-2.5">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {[row.original.firstName, row.original.lastName].filter(Boolean).join(' ') || '—'}
                </p>
                {row.original.email ? <p className="truncate text-[11px] text-muted-foreground">{row.original.email}</p> : null}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.phone || '—'}</span>,
      },
      {
        accessorKey: 'city',
        header: 'City',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.city || '—'}</span>,
      },
      {
        accessorKey: 'ordersCount',
        header: 'Orders',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.ordersCount}</span>,
      },
      {
        accessorKey: 'totalSpent',
        header: 'Total Spent',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(Number(row.original.totalSpent))}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    [],
  )

  return (
    <ShopifySyncPage
      title="Customers Sync"
      subtitle="Customer profiles pulled from Shopify, matched against your local customer list."
      resourceLabel="Customers"
      resource="customers"
      icon={Users}
      loader={shopifyApi.getCustomers}
      columns={columns}
      searchPlaceholder="Search name, email, phone, city..."
      emptyDescription="Customers pulled from your Shopify store will appear here after the first sync."
    />
  )
}
