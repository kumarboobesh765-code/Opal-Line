import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import { Building2, CheckCircle2, Download, Loader2, MoreHorizontal, Plus, Search, ShoppingCart, Weight, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import type { PurchaseOrder, Supplier } from '@/types'
import { formatCurrency, formatDate, formatWeight } from '@/lib/format'

const statusBadge: Record<PurchaseOrder['status'], { label: string; variant: 'warning' | 'success' | 'info' | 'muted' }> = {
  open: { label: 'Open', variant: 'warning' },
  received: { label: 'Received', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
  draft: { label: 'Draft', variant: 'info' },
  closed: { label: 'Closed', variant: 'muted' },
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ supplier: '', items: '', qty: '', weight: '', value: '' })

  const load = useCallback(() => {
    setLoading(true)
    dbApi.getPurchaseOrders().then((d) => {
      setOrders(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    dbApi.getSuppliers().then(setSuppliers).catch(() => setSuppliers([]))
  }, [])

  const openDialog = () => {
    setForm({ supplier: '', items: '', qty: '', weight: '', value: '' })
    setError('')
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.supplier) {
      setError('Select a supplier')
      return
    }
    setSaving(true)
    setError('')
    try {
      const count = orders.length + 1
      await dbApi.create('purchase-orders', {
        number: `PO-2026-${String(count + 17).padStart(4, '0')}`,
        supplier: form.supplier,
        items: parseInt(form.items || '1', 10),
        qty: parseInt(form.qty || '0', 10),
        weight: parseFloat(form.weight || '0'),
        value: parseFloat(form.value || '0'),
        status: 'open',
        date: new Date().toISOString(),
      })
      setDialogOpen(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create purchase order')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (order: PurchaseOrder, status: PurchaseOrder['status']) => {
    await dbApi.update('purchase-orders', order.id, { status })
    load()
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((o) => {
      const matchQ = !q || o.number.toLowerCase().includes(q) || o.supplier.toLowerCase().includes(q)
      const matchStatus = !statusFilter || o.status === statusFilter
      return matchQ && matchStatus
    })
  }, [orders, query, statusFilter])

  const totalValue = orders.filter((o) => o.status === 'open').reduce((a, o) => a + o.value, 0)
  const totalWeight = orders.reduce((a, o) => a + o.weight, 0)

  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'PO Number',
        meta: { headerClassName: 'min-w-[170px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <ShoppingCart className="h-4 w-4" />
            </div>
            <div>
              <p className="font-mono font-medium text-foreground">{row.original.number}</p>
              <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'supplier',
        header: 'Supplier',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {row.original.supplier}
          </span>
        ),
      },
      {
        accessorKey: 'items',
        header: 'Items',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.items}</span>,
      },
      {
        accessorKey: 'qty',
        header: 'Qty',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.qty}</span>,
      },
      {
        accessorKey: 'weight',
        header: 'Weight',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatWeight(row.original.weight)}</span>,
      },
      {
        accessorKey: 'value',
        header: 'Order Value',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.value)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusBadge[row.original.status]
          return <Badge variant={s.variant} dot>{s.label}</Badge>
        },
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
              <DropdownMenuItem>View PO</DropdownMenuItem>
              {row.original.status === 'open' ? (
                <DropdownMenuItem onClick={() => setStatus(row.original, 'received')}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Mark Received
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => navigate('/purchase/invoices')}>Create Purchase Invoice</DropdownMenuItem>
              <DropdownMenuSeparator />
              {row.original.status !== 'cancelled' ? (
                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => setStatus(row.original, 'cancelled')}>
                  <XCircle className="h-3.5 w-3.5" /> Cancel PO
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [load, setStatus],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Purchase Orders"
        subtitle="Orders raised with silver suppliers for raw material and finished pieces."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportTable('purchase-orders.csv', columns, filtered)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-4 w-4" /> New Purchase Order
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={ShoppingCart} label="Total POs" value={String(orders.length)} sub="All purchase orders" tint="bg-primary-50 text-primary-700" />
        <MiniCard icon={ShoppingCart} label="Open" value={String(orders.filter((o) => o.status === 'open').length)} sub="Awaiting receipt" tint="bg-warning-50 text-warning-700" />
        <MiniCard icon={Weight} label="Total Weight" value={formatWeight(totalWeight)} sub="Gross across POs" tint="bg-info-50 text-info-700" />
        <MiniCard icon={Building2} label="Open Value" value={formatCurrency(totalValue)} sub="Committed to suppliers" tint="bg-success-50 text-success-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search PO number, supplier..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'open', label: 'Open' },
                { value: 'received', label: 'Received' },
                { value: 'draft', label: 'Draft' },
                { value: 'closed', label: 'Closed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-[140px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {orders.length} POs
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No purchase orders found"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Raise a purchase order with a supplier for silver raw material.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Supplier">
              <Select
                options={[
                  { value: '', label: 'Select supplier...' },
                  ...suppliers.map((s) => ({ value: s.name, label: s.name })),
                ]}
                value={form.supplier}
                onValueChange={(v) => setForm((f) => ({ ...f, supplier: v }))}
                className="w-full"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Line Items">
                <Input
                  type="number" min="1"
                  value={form.items}
                  onChange={(e) => setForm((f) => ({ ...f, items: e.target.value }))}
                />
              </Field>
              <Field label="Quantity">
                <Input
                  type="number" min="0"
                  value={form.qty}
                  onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                />
              </Field>
              <Field label="Weight (gm)">
                <Input
                  type="number" min="0" step="0.1"
                  value={form.weight}
                  onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                />
              </Field>
              <Field label="Order Value (₹)">
                <Input
                  type="number" min="0" step="0.1"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
              </Field>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
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
