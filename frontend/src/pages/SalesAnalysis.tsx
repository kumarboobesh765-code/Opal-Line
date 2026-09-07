import { useEffect, useState } from 'react'
import { BarChart3, Download, IndianRupee, Package, ShoppingBag, TrendingUp, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { SalesOverviewChart } from '@/components/charts/sales-overview-chart'
import { dbApi } from '@/lib/api'
import { exportCsv } from '@/lib/export'
import type { SalesOverviewPoint, TopProduct } from '@/types'
import { formatCurrency } from '@/lib/format'

export default function SalesAnalysisPage() {
  const [data, setData] = useState<SalesOverviewPoint[]>([])
  const [top, setTop] = useState<TopProduct[]>([])
  const [repeatRate, setRepeatRate] = useState<number | null>(null)
  const [period, setPeriod] = useState('week')

  useEffect(() => {
    dbApi.getSalesOverview(period).then(setData).catch(() => {})
  }, [period])

  useEffect(() => {
    dbApi.getTopProducts().then(setTop).catch(() => {})
  }, [])

  useEffect(() => {
    dbApi.getCustomers().then((customers) => {
      const count = customers.length
      const repeat = customers.filter((c) => Number(c.orders) >= 2).length
      setRepeatRate(count > 0 ? (repeat / count) * 100 : 0)
    }).catch(() => {})
  }, [])

  const totalRevenue = data.reduce((a, d) => a + d.revenue, 0)
  const totalOrders = data.reduce((a, d) => a + d.orders, 0)

  const exportReport = () => {
    exportCsv('sales-analysis.csv', [
      { Metric: 'Revenue', Value: totalRevenue },
      { Metric: 'Orders', Value: totalOrders },
      { Metric: 'Avg Order Value', Value: totalOrders ? totalRevenue / totalOrders : 0 },
      { Metric: 'Repeat Rate (%)', Value: repeatRate !== null ? repeatRate.toFixed(1) : '' },
      ...top.map((p) => ({ Metric: `Top Product: ${p.name} (${p.sku})`, Value: `${p.qty} pcs · ${p.weight} gm · ${formatCurrency(p.revenue)}` })),
    ])
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Sales Analysis"
        subtitle="Revenue, orders and product performance across the selected period."
        actions={
          <>
            <Select
              options={[
                { value: 'today', label: 'Today' },
                { value: 'week', label: 'This Week' },
                { value: 'month', label: 'This Month' },
                { value: 'year', label: 'This Year' },
              ]}
              value={period}
              onValueChange={setPeriod}
              className="w-[150px]"
            />
            <Button variant="outline" size="sm" onClick={exportReport}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={IndianRupee} label="Revenue" value={formatCurrency(totalRevenue)} sub="Selected period" tint="bg-primary-50 text-primary-700" />
        <MiniCard icon={ShoppingBag} label="Orders" value={String(totalOrders)} sub="Total orders" tint="bg-info-50 text-info-700" />
        <MiniCard icon={TrendingUp} label="Avg Order Value" value={formatCurrency(totalOrders ? totalRevenue / totalOrders : 0)} sub="Per order" tint="bg-success-50 text-success-700" />
        <MiniCard
          icon={Users}
          label="Repeat Rate"
          value={repeatRate !== null ? `${repeatRate.toFixed(1)}%` : '—'}
          sub="Customers with 2+ orders"
          tint="bg-warning-50 text-warning-700"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Sales Overview</h3>
          </div>
          <SalesOverviewChart data={data} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Top Products</h3>
          </div>
          <div className="space-y-3">
            {top.map((p, i) => {
              const max = top[0]?.revenue || 1
              return (
                <div key={p.id} className="flex items-center gap-4">
                  <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                  <div className="w-36 shrink-0">
                    <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.sku}</p>
                  </div>
                  <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="flex h-full items-center rounded-full bg-gradient-to-r from-primary-600 to-primary-400"
                      style={{ width: `${Math.round((p.revenue / max) * 100)}%` }}
                    />
                  </div>
                  <div className="w-24 shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(p.revenue)}</p>
                    <p className="text-[11px] text-muted-foreground">{p.qty} pcs · {p.weight} gm</p>
                  </div>
                </div>
              )
            })}
          </div>
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
