import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@/lib/table'
import { CheckCircle2, MoreHorizontal, RefreshCw, Search, Undo2, Weight, XCircle } from 'lucide-react'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dbApi } from '@/lib/api'
import type { PurchaseReturn } from '@/types'
import { formatCurrency, formatDate, formatWeight } from '@/lib/format'

const statusBadge: Record<PurchaseReturn['status'], { label: string; variant: 'success' | 'warning' | 'info' | 'muted' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  rejected: { label: 'Rejected', variant: 'muted' },
  received: { label: 'Received', variant: 'success' },
}

export default function PurchaseReturnsPage() {
  const [returns, setReturns] = useState<PurchaseReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    dbApi.getPurchaseReturns().then((d) => {
      setReturns(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const setReturnStatus = async (id: string, status: PurchaseReturn['status']) => {
    try {
      await dbApi.update('purchase-returns', id, { status })
      setReturns((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return returns.filter((r) => {
      const matchQ = !q || r.number.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q)
      const matchStatus = !statusFilter || r.status === statusFilter
      return matchQ && matchStatus
    })
  }, [returns, query, statusFilter])

  const totalWeight = returns.reduce((a, r) => a + r.weight, 0)

  const columns = useMemo<ColumnDef<PurchaseReturn>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Return Number',
        meta: { headerClassName: 'min-w-[160px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-700">
              <Undo2 className="h-4 w-4" />
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
        accessorKey: 'items',
        header: 'Items',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.items}</span>,
      },
      {
        accessorKey: 'weight',
        header: 'Weight',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatWeight(row.original.weight)}</span>,
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.amount)}</span>,
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
              <DropdownMenuItem>View Return</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReturnStatus(row.original.id, 'approved')}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReturnStatus(row.original.id, 'received')}><RefreshCw className="h-3.5 w-3.5" /> Mark Received</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReturnStatus(row.original.id, 'rejected')}><XCircle className="h-3.5 w-3.5" /> Reject</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Purchase Returns"
        subtitle="Silver returned to suppliers due to defects, short-weight or rejected lots."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={Undo2} label="Total Returns" value={String(returns.length)} sub="All time" tint="bg-primary-50 text-primary-700" />
        <MiniCard icon={Weight} label="Returned Weight" value={formatWeight(totalWeight)} sub="Gross weight" tint="bg-info-50 text-info-700" />
        <MiniCard icon={Undo2} label="Pending" value={String(returns.filter((r) => r.status === 'pending').length)} sub="Awaiting decision" tint="bg-warning-50 text-warning-700" />
        <MiniCard icon={CheckCircle2} label="Received Back" value={String(returns.filter((r) => r.status === 'received').length)} sub="Accepted by supplier" tint="bg-success-50 text-success-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search return, supplier..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'pending', label: 'Pending' },
                { value: 'approved', label: 'Approved' },
                { value: 'received', label: 'Received' },
                { value: 'rejected', label: 'Rejected' },
              ]}
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-[140px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {returns.length} returns
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No purchase returns found"
          />
        </CardContent>
      </Card>
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
