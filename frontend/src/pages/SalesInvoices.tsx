import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import { Download, Eye, FileText, MoreHorizontal, Plus, Printer, Search, Undo2, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dbApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { Invoice } from '@/types'
import { formatCurrency, formatDate } from '@/lib/format'

const paymentBadge: Record<Invoice['paymentStatus'], { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }> = {
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Partial', variant: 'warning' },
  pending: { label: 'Pending', variant: 'warning' },
  failed: { label: 'Failed', variant: 'danger' },
  refunded: { label: 'Refunded', variant: 'muted' },
}

const statusBadge: Record<Invoice['status'], { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  paid: { label: 'Paid', variant: 'success' },
  draft: { label: 'Draft', variant: 'muted' },
  issued: { label: 'Issued', variant: 'info' },
  overdue: { label: 'Overdue', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
  refunded: { label: 'Refunded', variant: 'warning' },
}

export default function SalesInvoicesPage() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const setInvoiceStatus = async (inv: Invoice, status: Invoice['status']) => {
    if (!window.confirm(`Mark invoice ${inv.number} as ${status}?`)) return
    try {
      const patch: Record<string, unknown> = { status }
      if (status === 'refunded') patch.paymentStatus = 'refunded'
      await dbApi.update('invoices', inv.id, patch)
      setInvoices((prev) => prev.map((x) => (x.id === inv.id ? { ...x, ...patch } : x)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  useEffect(() => {
    dbApi.getInvoices().then((d) => {
      setInvoices(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter((i) => {
      const matchQ =
        !q ||
        i.number.toLowerCase().includes(q) ||
        (i.shopifyOrder ?? '').toLowerCase().includes(q) ||
        i.customer.toLowerCase().includes(q)
      const matchPay = !paymentFilter || i.paymentStatus === paymentFilter
      const matchStatus = !statusFilter || i.status === statusFilter
      return matchQ && matchPay && matchStatus
    })
  }, [invoices, query, paymentFilter, statusFilter])

  const columns = useMemo<ColumnDef<Invoice>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Invoice',
        meta: { headerClassName: 'min-w-[150px]' },
        cell: ({ row }) => (
          <Link to={`/sales/invoices/${row.original.id}`} className="group">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-foreground group-hover:text-primary-700">{row.original.number}</p>
                <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
              </div>
            </div>
          </Link>
        ),
      },
      {
        accessorKey: 'shopifyOrder',
        header: 'Shopify Order',
        cell: ({ row }) => <span className="font-mono text-[12.5px] text-muted-foreground">{row.original.shopifyOrder}</span>,
      },
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-foreground">{row.original.customer}</p>
            <p className="text-[11px] text-muted-foreground">{row.original.customerEmail}</p>
            {row.original.customerPhone ? <p className="text-[11px] text-muted-foreground">{row.original.customerPhone}</p> : null}
          </div>
        ),
      },
      {
        accessorKey: 'grandTotal',
        header: 'Amount',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.grandTotal)}</span>,
      },
      {
        id: 'payment',
        header: 'Payment',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const p = paymentBadge[row.original.paymentStatus]
          return <Badge variant={p.variant} dot>{p.label}</Badge>
        },
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusBadge[row.original.status]
          return <Badge variant={s.variant}>{s.label}</Badge>
        },
      },
      {
        accessorKey: 'paymentMethod',
        header: 'Method',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.paymentMethod}</span>,
      },
      {
        id: 'actions',
        header: '',
        meta: { align: 'right' as const, headerClassName: 'w-10' },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Actions</DropdownMenuLabel>
              <DropdownMenuItem>
                <Link to={`/sales/invoices/${row.original.id}`} className="flex w-full items-center gap-2">
                  <Eye className="h-3.5 w-3.5" /> View
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/sales/invoices/${row.original.id}`)}><Printer className="h-3.5 w-3.5" /> Print</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/sales/invoices/${row.original.id}`)}><Download className="h-3.5 w-3.5" /> Download PDF</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setInvoiceStatus(row.original, 'refunded')}><Undo2 className="h-3.5 w-3.5" /> Refund</DropdownMenuItem>
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setInvoiceStatus(row.original, 'cancelled')}><X className="h-3.5 w-3.5" /> Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 sm:space-y-5 sm:py-6 lg:px-6">
      <PageHeader
        title="Sales Invoices"
        subtitle="Invoices generated from Shopify orders, reconciled with Razorpay payments."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => exportTable('sales-invoices.csv', columns, filtered)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" onClick={() => navigate('/shopify/orders')}>
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Invoice</span><span className="sm:hidden">New</span>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-0 flex-1 sm:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search invoice, order, customer..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                options={[
                  { value: '', label: 'All Payment' },
                  { value: 'paid', label: 'Paid' },
                  { value: 'partial', label: 'Partial' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'refunded', label: 'Refunded' },
                ]}
                value={paymentFilter}
                onValueChange={setPaymentFilter}
                className="w-[calc(50%-4px)] sm:w-[140px]"
              />
              <Select
                options={[
                  { value: '', label: 'All Status' },
                  { value: 'paid', label: 'Paid' },
                  { value: 'issued', label: 'Issued' },
                  { value: 'overdue', label: 'Overdue' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
                value={statusFilter}
                onValueChange={setStatusFilter}
                className="w-[calc(50%-4px)] sm:w-[140px]"
              />
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {invoices.length} invoices
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No invoices match your filters"
          />
        </CardContent>
      </Card>
    </div>
  )
}
