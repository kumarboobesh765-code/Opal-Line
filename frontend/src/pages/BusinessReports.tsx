import { useEffect, useState } from 'react'
import { BarChart3, Boxes, CalendarDays, Download, IndianRupee, LayoutDashboard, Package, TrendingUp, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { dbApi } from '@/lib/api'
import type { SilverRate } from '@/types'
import { formatCurrency, todayIST } from '@/lib/format'

interface BusinessStats {
  revenueMonth: number
  ordersMonth: number
  aov: number
  grossProfitMonth: number
  grossMarginPct: number
  inventoryValue: number
  lowStockCount: number
  returnRatePct: number
}

export default function BusinessReportsPage() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof dbApi.getDashboardSummary>> | null>(null)
  const [rate, setRate] = useState<SilverRate | null>(null)
  const [stats, setStats] = useState<BusinessStats | null>(null)
  const [period, setPeriod] = useState('month')

  useEffect(() => {
    Promise.all([
      dbApi.getDashboardSummary(),
      dbApi.getSilverRate().catch(() => null),
      dbApi.getSalesOverview(period),
      dbApi.getInvoices(),
      dbApi.getLowStock(),
      dbApi.getSalesReturns(),
    ]).then(([s, r, overview, invoices, lowStock, returnsList]) => {
      const revenueMonth = overview.reduce((a, d) => a + d.revenue, 0)
      const ordersMonth = overview.reduce((a, d) => a + d.orders, 0)
      const monthKey = todayIST().slice(0, 7)
      const monthInvoices = invoices.filter((i) => String(i.date ?? '').startsWith(monthKey))
      const grossProfitMonth = monthInvoices.reduce((a, i) => a + (i.grandTotal - i.silverValue - i.makingCharge), 0)
      const inventoryValue = s.totalStockWeight * (r?.rate ?? 0)
      setSummary(s)
      setRate(r)
      setStats({
        revenueMonth,
        ordersMonth,
        aov: ordersMonth > 0 ? revenueMonth / ordersMonth : 0,
        grossProfitMonth,
        grossMarginPct: revenueMonth > 0 ? (grossProfitMonth / revenueMonth) * 100 : 0,
        inventoryValue,
        lowStockCount: lowStock.length,
        returnRatePct: invoices.length > 0 ? (returnsList.length / invoices.length) * 100 : 0,
      })
    }).catch(() => {})
  }, [period])

  const exportPdf = () => {
    if (!summary || !stats) return
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    w.opener = null
    w.document.write(`<!doctype html><html><head><title>Business Report</title><style>
      body{font-family:Arial,sans-serif;color:#111;margin:32px}
      h1{font-size:20px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{text-align:left;background:#f1f5f9;padding:8px} td{padding:8px;border-top:1px solid #e2e8f0}
    </style></head><body>
      <h1>Opal Line · Business Report</h1>
      <div class="sub">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Revenue (Month)</td><td>${formatCurrency(stats.revenueMonth)}</td></tr>
        <tr><td>Orders (Month)</td><td>${stats.ordersMonth}</td></tr>
        <tr><td>Avg Order Value</td><td>${formatCurrency(stats.aov)}</td></tr>
        <tr><td>Gross Profit (Month)</td><td>${formatCurrency(stats.grossProfitMonth)} (${stats.grossMarginPct.toFixed(1)}% margin)</td></tr>
        <tr><td>Inventory Value</td><td>${formatCurrency(stats.inventoryValue)}</td></tr>
        <tr><td>Low Stock Items</td><td>${stats.lowStockCount}</td></tr>
        <tr><td>Return Rate</td><td>${stats.returnRatePct.toFixed(1)}%</td></tr>
        <tr><td>Total Stock (Qty)</td><td>${summary.totalStockQty}</td></tr>
        <tr><td>Total Stock (Weight)</td><td>${summary.totalStockWeight} gm</td></tr>
        <tr><td>Active Suppliers</td><td>${summary.activeSuppliers} of ${summary.totalSuppliers}</td></tr>
        <tr><td>Pending Payments</td><td>${formatCurrency(summary.pendingPayments)}</td></tr>
      </table>
      <script>window.onload=function(){window.focus();window.print();}</script>
    </body></html>`)
    w.document.close()
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Business Reports"
        subtitle="One-page snapshot of the Opal Line business — sales, inventory, customers and suppliers."
        actions={
          <>
            <Select
              options={[
                { value: 'month', label: 'This Month' },
                { value: 'quarter', label: 'This Quarter' },
                { value: 'year', label: 'This Year' },
              ]}
              value={period}
              onValueChange={setPeriod}
              className="w-[150px]"
            />
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <Download className="h-3.5 w-3.5" /> Export PDF
            </Button>
          </>
        }
      />

      {!summary || !stats ? (
        <Card className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading summary...</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniCard icon={IndianRupee} label="Revenue (Month)" value={formatCurrency(stats?.revenueMonth ?? 0)} sub="Current month sales" tint="bg-primary-50 text-primary-700" />
            <MiniCard icon={Package} label="AOV" value={formatCurrency(stats?.aov ?? 0)} sub={`${stats?.ordersMonth ?? 0} orders`} tint="bg-info-50 text-info-700" />
            <MiniCard icon={Users} label="Return Rate" value={`${stats ? stats.returnRatePct.toFixed(1) : '0.0'}%`} sub="Of total orders" tint="bg-success-50 text-success-700" />
            <MiniCard icon={BarChart3} label="Gross Profit (Month)" value={formatCurrency(stats?.grossProfitMonth ?? 0)} sub={`${stats ? stats.grossMarginPct.toFixed(1) : '0.0'}% margin`} tint="bg-warning-50 text-warning-700" />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">Business Snapshot</h3>
                  <CalendarDays className="ml-auto h-4 w-4 text-muted-foreground" />
                </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                   <SnapshotStat label="Total Stock (Qty)" value={String(summary.totalStockQty)} />
                   <SnapshotStat label="Total Stock (Weight)" value={`${summary.totalStockWeight} gm`} />
                   <SnapshotStat label="Suppliers" value={String(summary.totalSuppliers)} />
                   <SnapshotStat label="Active Suppliers" value={String(summary.activeSuppliers)} />
                    <SnapshotStat label="Today's Expenses" value={formatCurrency(summary?.todayExpenses ?? 0)} />
                   <SnapshotStat label="Gross Profit" value={formatCurrency(stats?.grossProfitMonth ?? 0)} />
                 </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">Quick Highlights</h3>
                </div>
                <div className="space-y-3">
                  <HighlightRow label="AOV" value={formatCurrency(stats?.aov ?? 0)} delta="Per order" />
                  <HighlightRow label="Return Rate" value={`${stats ? stats.returnRatePct.toFixed(2) : '0.00'}%`} delta="Returns vs invoices" />
                  <HighlightRow label="Gross Margin" value={`${stats ? stats.grossMarginPct.toFixed(2) : '0.00'}%`} delta="Current month" />
                  <HighlightRow label="Inventory Value" value={formatCurrency(stats?.inventoryValue ?? 0)} delta="At current rate" />
                  <HighlightRow label="Low Stock Items" value={String(stats?.lowStockCount ?? 0)} delta="Needs reorder" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-700">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Inventory valuation by current silver rate</p>
                <p className="text-xs text-muted-foreground">
                  {summary.totalStockWeight} gm of finished silver at ₹{rate ? rate.rate.toFixed(2) : '—'}/gm ≈{' '}
                  {formatCurrency(summary.totalStockWeight * (rate?.rate ?? 0))}
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
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

function SnapshotStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function HighlightRow({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-semibold tabular-nums text-foreground">{value}</span>
        <span className="text-[11px] text-success-700">{delta}</span>
      </span>
    </div>
  )
}
