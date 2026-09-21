import { toast } from '@/components/ui/confirm'
﻿import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@/lib/table'
import { Ban, CheckCircle2, FileDown, Search, Undo2, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { dbApi, backupApi } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/format'

const statusMeta: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  refunded: { label: 'Refunded', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'muted' },
}

export default function ReturnsPage() {
  const [returns, setReturns] = useState<ReturnType<typeof dbApi.getSalesReturns> extends Promise<infer T> ? T : never>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState<{ total: number; pending: number; pendingAmount: number; refunded: number; refundedAmount: number; rate: number } | null>(null)

  useEffect(() => {
    Promise.all([dbApi.getSalesReturns(), dbApi.getInvoices()]).then(([d, inv]) => {
      const list = d as never[]
      setReturns(d as never)
      const totalInvoices = inv.length
      const pending = list.filter((r) => (r as { status?: string }).status === 'pending')
      const refunded = list.filter((r) => (r as { status?: string }).status === 'refunded')
      setStats({
        total: list.length,
        pending: pending.length,
        pendingAmount: pending.reduce((s, r) => s + Number((r as { amount?: unknown }).amount ?? 0), 0),
        refunded: refunded.length,
        refundedAmount: refunded.reduce((s, r) => s + Number((r as { amount?: unknown }).amount ?? 0), 0),
        rate: totalInvoices > 0 ? (list.length / totalInvoices) * 100 : 0,
      })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const setReturnStatus = async (id: string, status: 'approved' | 'rejected' | 'refunded') => {
    try {
      await dbApi.update('sales-returns', id, { status })
      setReturns((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)) as never)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return returns
    return returns.filter((r: any) =>
      String(r.id ?? '').toLowerCase().includes(q) ||
      String(r.customer ?? '').toLowerCase().includes(q) ||
      String(r.number ?? '').toLowerCase().includes(q) ||
      String(r.order ?? '').toLowerCase().includes(q) ||
      String(r.status ?? '').toLowerCase().includes(q)
    )
  }, [returns, query])

  const columns = useMemo<ColumnDef<(typeof returns)[number]>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Return Number',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-warning-50 text-warning-700">
              <Undo2 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-foreground">{row.original.number}</p>
              <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
            </div>
          </div>
        ),
      },
      { accessorKey: 'order', header: 'Shopify Order', cell: ({ row }) => <span className="font-mono text-[12.5px] text-muted-foreground">{row.original.order}</span> },
      { accessorKey: 'customer', header: 'Customer', cell: ({ row }) => <span className="font-medium text-foreground">{row.original.customer}</span> },
      {
        accessorKey: 'amount',
        header: 'Refund Amount',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.amount)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusMeta[row.original.status]
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
                  <Button variant="ghost" size="icon-sm" onClick={() => backupApi.downloadCreditNotePDF(row.original.id)}>
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Credit note PDF</TooltipContent>
              </Tooltip>
              {row.original.status === 'pending' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => setReturnStatus(row.original.id, 'approved')}>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Approve return</TooltipContent>
                </Tooltip>
              )}
              {row.original.status === 'pending' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => setReturnStatus(row.original.id, 'rejected')}>
                      <Ban className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reject return</TooltipContent>
                </Tooltip>
              )}
              {row.original.status === 'approved' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => setReturnStatus(row.original.id, 'refunded')}>
                      <Wallet className="h-3.5 w-3.5 text-warning-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Process refund via Razorpay</TooltipContent>
                </Tooltip>
              )}
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
        title="Sales Returns"
        subtitle="Returns requested against Shopify orders — approve and refund through Razorpay."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard label="Total Returns" value={stats ? String(stats.total) : '—'} sub="All returns" tint="text-primary-700" />
        <MiniCard
          label="Pending Approval"
          value={stats ? String(stats.pending) : '—'}
          sub={stats ? `${formatCurrency(stats.pendingAmount)} pending` : '—'}
          tint="text-warning-700"
        />
        <MiniCard
          label="Refunded"
          value={stats ? String(stats.refunded) : '—'}
          sub={stats ? `${formatCurrency(stats.refundedAmount)} refunded` : '—'}
          tint="text-success-700"
        />
        <MiniCard
          label="Return Rate"
          value={stats ? `${stats.rate.toFixed(2)}%` : '—'}
          sub="Returns vs invoices"
          tint="text-info-700"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative min-w-[240px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search return, order, customer..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <DataTable columns={columns} data={filtered} loading={loading} emptyMessage="No returns found" />
        </CardContent>
      </Card>
    </div>
  )
}

function MiniCard({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tint}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </Card>
  )
}
