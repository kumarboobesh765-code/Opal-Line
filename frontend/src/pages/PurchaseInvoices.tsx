import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@/lib/table'
import { Download, Eye, Receipt, Search, Weight, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dbApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { PurchaseInvoice } from '@/types'
import { formatCurrency, formatDate, formatNumber, formatWeight } from '@/lib/format'

const statusBadge: Record<PurchaseInvoice['status'], { label: string; variant: 'success' | 'warning' | 'info' | 'muted' }> = {
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Partial', variant: 'info' },
  pending: { label: 'Pending', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
}

export default function PurchaseInvoicesPage() {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoice | null>(null)

  useEffect(() => {
    dbApi.getPurchaseInvoices().then((d) => {
      setInvoices(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter((i) => {
      const matchQ = !q || i.number.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q)
      const matchStatus = !statusFilter || i.status === statusFilter
      return matchQ && matchStatus
    })
  }, [invoices, query, statusFilter])

  const outstanding = invoices.filter((i) => i.status !== 'paid').reduce((a, i) => a + i.total, 0)
  const totalWeight = invoices.reduce((a, i) => a + i.weight, 0)

  const columns = useMemo<ColumnDef<PurchaseInvoice>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Purchase Invoice',
        meta: { headerClassName: 'min-w-[160px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-foreground">{row.original.number}</p>
              <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'supplier',
        header: 'Supplier',
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.supplier}</span>,
      },
      {
        accessorKey: 'weight',
        header: 'Weight',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatWeight(row.original.weight)}</span>,
      },
      {
        accessorKey: 'rate',
        header: 'Rate / gm',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">₹{row.original.rate.toFixed(1)}</span>,
      },
      {
        accessorKey: 'cost',
        header: 'Cost',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatCurrency(row.original.cost)}</span>,
      },
      {
        accessorKey: 'tax',
        header: 'GST',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatCurrency(row.original.tax)}</span>,
      },
      {
        accessorKey: 'total',
        header: 'Total',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.total)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusBadge[row.original.status] ?? { label: row.original.status ?? "—", variant: "muted" as const }
          return <Badge variant={s.variant} dot>{s.label}</Badge>
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        meta: { align: 'right' as const, headerClassName: 'w-10' },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => setViewInvoice(row.original)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View invoice details</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ),
      },
    ],
    [],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Purchase Invoices"
        subtitle="Supplier invoices for raw silver received against purchase orders."
        actions={
          <Button variant="outline" size="sm" onClick={() => exportTable('purchase-invoices.csv', columns, filtered)}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={Receipt} label="Total Invoices" value={formatNumber(invoices.length)} sub="All time" tint="bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300" />
        <MiniCard icon={Wallet} label="Total Value" value={formatCurrency(invoices.reduce((a, i) => a + i.total, 0))} sub="Including GST" tint="bg-info-50 text-info-700" />
        <MiniCard icon={Wallet} label="Outstanding" value={formatCurrency(outstanding)} sub="Not yet paid" tint="bg-warning-50 text-warning-700" />
        <MiniCard icon={Weight} label="Silver Received" value={formatWeight(totalWeight)} sub="Gross weight" tint="bg-success-50 text-success-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search invoice, supplier..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'paid', label: 'Paid' },
                { value: 'partial', label: 'Partial' },
                { value: 'pending', label: 'Pending' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-[140px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {invoices.length} invoices
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No purchase invoices found"
            onRowClick={(i) => setViewInvoice(i)}
          />
        </CardContent>
      </Card>

      <Dialog open={viewInvoice !== null} onOpenChange={(open) => { if (!open) setViewInvoice(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Purchase Invoice {viewInvoice?.number}</DialogTitle>
            <DialogDescription>{viewInvoice ? formatDate(viewInvoice.date) : ''}</DialogDescription>
          </DialogHeader>
          {viewInvoice && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span className="font-medium">{viewInvoice.supplier}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant={statusBadge[viewInvoice.status].variant} dot>{statusBadge[viewInvoice.status].label}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span>{viewInvoice.items} ({viewInvoice.qty} pcs)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Weight</span><span>{formatWeight(viewInvoice.weight)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rate / gm</span><span>₹{viewInvoice.rate.toFixed(1)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span>{formatCurrency(viewInvoice.cost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>{formatCurrency(viewInvoice.tax)}</span></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>{formatCurrency(viewInvoice.total)}</span></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MiniCard({ icon: Icon, label, value, sub, tint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tint: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
          {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </Card>
  )
}
