import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Banknote,
  Boxes,
  Calendar,
  ChevronDown,
  CircleDollarSign,
  Clock,
  CloudCog,
  FileText,
  Gem,
  IndianRupee,
  Landmark,
  Package,
  PackageX,
  Plus,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { SalesOverviewChart } from '@/components/charts/sales-overview-chart'
import { SilverRateChart } from '@/components/charts/silver-rate-chart'
import { PaymentDonutChart } from '@/components/charts/payment-donut-chart'
import { dbApi } from '@/lib/api'
import { shopifyApi } from '@/lib/api'
import type {
  Activity,
  AnalyticsStat,
  KpiCardData,
  LowStockItem,
  PaymentStatusSegment,
  SalesOverviewPoint,
  SilverRate,
  SilverRatePoint,
  TopProduct,
} from '@/types'
import type { ShopifyStatus } from '@/types/shopify'
import { compactCurrency, formatCurrency, formatDateTime, formatPieces, formatWeight } from '@/lib/format'
import { cn } from '@/lib/utils'

const kpiIcons: Record<string, LucideIcon> = {
  'indian-rupee': IndianRupee,
  'shopping-bag': ShoppingBag,
  'file-text': FileText,
  'trending-up': TrendingUp,
  clock: Clock,
  'package-x': PackageX,
}

const productIcons: Record<string, LucideIcon> = {
  chain: ShoppingBag,
  ring: Gem,
  bracelet: CircleDollarSign,
  pendant: Sparkles,
  earrings: Package,
}

const activityIcons: Record<Activity['type'], { icon: LucideIcon; className: string }> = {
  'silver-rate': { icon: Tag, className: 'bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300' },
  'shopify-import': { icon: ShoppingBag, className: 'bg-info-50 text-info-700' },
  invoice: { icon: FileText, className: 'bg-success-50 text-success-700' },
  payment: { icon: IndianRupee, className: 'bg-success-50 text-success-700' },
  product: { icon: Gem, className: 'bg-warning-50 text-warning-700' },
  sync: { icon: Repeat, className: 'bg-info-50 text-info-700' },
  user: { icon: Users, className: 'bg-muted text-muted-foreground' },
  purchase: { icon: ShoppingCart, className: 'bg-warning-50 text-warning-700' },
}

const ListOrderedIcon = FileText

const quickActions: { label: string; icon: LucideIcon; path: string; module: string }[] = [
  { label: 'Sales Invoice', icon: FileText, path: '/sales/invoices', module: 'sales' },
  { label: 'Sales Order', icon: ListOrderedIcon, path: '/sales/orders', module: 'sales' },
  { label: 'Purchase', icon: ShoppingCart, path: '/purchase/orders', module: 'purchase' },
  { label: 'Product', icon: Gem, path: '/inventory/products', module: 'inventory' },
  { label: 'Customer', icon: Users, path: '/sales/customers', module: 'sales' },
  { label: 'Silver Rate', icon: Tag, path: '/silver-rate', module: 'silver-rate' },
  { label: 'Expense', icon: Wallet, path: '/accounts/expenses', module: 'accounts' },
  { label: 'Stock Transfer', icon: Repeat, path: '/inventory/transfers', module: 'inventory' },
  { label: 'Reports', icon: TrendingUp, path: '/reports/business', module: 'reports' },
  { label: 'More', icon: Plus, path: '#', module: '' },
]

export default function DashboardPage() {
  const navigate = useNavigate()
  const [kpis, setKpis] = useState<KpiCardData[]>([])
  const [summary, setSummary] = useState<Record<string, string | number> | null>(null)
  const [salesData, setSalesData] = useState<SalesOverviewPoint[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [paymentStatus, setPaymentStatus] = useState<{ segments: PaymentStatusSegment[]; total: number } | null>(null)
  const [silverRate, setSilverRate] = useState<SilverRate | null>(null)
  const [silverHistory, setSilverHistory] = useState<SilverRatePoint[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsStat[]>([])
  const [shopifyStatus, setShopifyStatus] = useState<ShopifyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodKey>('week')
  const [customRange, setCustomRange] = useState<DateRange>(() => defaultRange())

  useEffect(() => {
    let cancelled = false
    Promise.all([
      dbApi.getDashboardKpis().catch(() => []),
      dbApi.getDashboardSummary().catch(() => ({ totalProducts: 0, activeProducts: 0, totalCustomers: 0, activeCustomers: 0, totalSuppliers: 0, activeSuppliers: 0, totalStockQty: 0, totalStockWeight: 0, todayExpenses: 0, pendingPayments: 0 })),
      dbApi.getTopProducts().catch(() => []),
      dbApi.getPaymentStatus().catch(() => ({ segments: [], total: 0 })),
      dbApi.getSilverRate().catch(() => null),
      dbApi.getSilverRateHistory().catch(() => []),
      dbApi.getLowStock().catch(() => []),
      dbApi.getRecentActivities().catch(() => []),
      dbApi.getAnalyticsStats().catch(() => []),
      shopifyApi.getStatus().catch(() => null),
    ]).then(([k, s, tp, ps, sr, sh, ls, ac, an, ss]) => {
      if (cancelled) return
      setKpis(k)
      setSummary(s)
      setTopProducts(tp)
      setPaymentStatus(ps)
      setSilverRate(sr)
      setSilverHistory(sh)
      setLowStock(ls)
      setActivities(ac)
      setAnalytics(an)
      setShopifyStatus(ss)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const request =
      period === 'custom' ? dbApi.getSalesOverview('custom', customRange) : dbApi.getSalesOverview(period)
    request
      .then((data) => {
        if (!cancelled) setSalesData(data)
      })
      .catch(() => {
        if (!cancelled) setSalesData([])
      })
    return () => {
      cancelled = true
    }
  }, [period, customRange])

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Dashboard"
        subtitle="Here's what's happening with your ecommerce business today."
        actions={
          <PeriodSelect
            value={period}
            onChange={setPeriod}
            range={customRange}
            onRangeChange={setCustomRange}
            variant="range"
            align="right"
          />
        }
      />

                <ConnectionBanner rate={silverRate?.rate ?? null} shopifyStatus={shopifyStatus} />

      <QuickActions />

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {kpis.map((kpi) => (
              <StatCard
                key={kpi.key}
                icon={kpiIcons[kpi.icon] ?? Banknote}
                title={kpi.label}
                value={kpi.value}
                trend={kpi.trend}
                delta={kpi.delta}
                support={kpi.deltaLabel}
                accent={kpi.accent as 'purple'}
              />
            ))}
          </div>

          {summary ? <OperationalStrip summary={summary} /> : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-1">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Sales Overview</CardTitle>
                <PeriodSelect
                  value={period}
                  onChange={setPeriod}
                  range={customRange}
                  onRangeChange={setCustomRange}
                  variant="pill"
                />
              </CardHeader>
              <CardContent>
                <SalesOverviewChart data={salesData} />
              </CardContent>
            </Card>

            <Card className="xl:col-span-1">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Top Selling Products</CardTitle>
                <Button variant="ghost" size="sm" className="gap-1 px-2 text-primary" onClick={() => navigate('/reports/sales')}>
                  View All <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((p) => {
                      const Icon = productIcons[p.icon] ?? Package
                      return (
                        <TableRow key={p.id} className="border-b-0">
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{p.name}</p>
                                <p className="text-[11px] text-muted-foreground">{p.sku}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatNumber(p.qty)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatWeight(p.weight)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-foreground">{compactCurrency(p.revenue)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="xl:col-span-1">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Payment Status</CardTitle>
                <Badge variant="muted" className="text-[10px]">{formatCurrency(paymentStatus?.total ?? 0, { compact: true })}</Badge>
              </CardHeader>
              <CardContent>
                {paymentStatus ? (
                  <>
                    <PaymentDonutChart data={paymentStatus.segments} centerTotal={paymentStatus.total} />
                    <div className="mt-2 space-y-1.5">
                      {paymentStatus.segments.map((s) => (
                        <div key={s.status} className="flex items-center gap-2 text-[12px]">
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              s.status === 'paid' && 'bg-success',
                              s.status === 'pending' && 'bg-warning',
                              s.status === 'failed' && 'bg-destructive',
                            )}
                          />
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="ml-auto font-semibold tabular-nums text-foreground">{compactCurrency(s.value)}</span>
                          <span className="w-9 text-right tabular-nums text-muted-foreground">
                            {paymentStatus.total > 0 ? `${Math.round((s.value / paymentStatus.total) * 100)}%` : '0%'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Button variant="soft-primary" className="mt-4 w-full" size="sm" onClick={() => navigate('/accounts/payments')}>
                      View Details
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-1">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm">Silver Rate History ({silverRate?.purity ?? 92.5})</CardTitle>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Last 7 days · ₹ / gm</p>
                </div>
                <Badge variant="success" className="text-[10px]">
                  Today: {silverRate ? `₹${silverRate.rate.toFixed(2)} / gm` : '—'}
                </Badge>
              </CardHeader>
              <CardContent>
                <SilverRateChart data={silverHistory} />
              </CardContent>
            </Card>

            <Card className="xl:col-span-1">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Low Stock Alert</CardTitle>
                <Button variant="ghost" size="sm" className="gap-1 px-2 text-primary" onClick={() => navigate('/inventory/low-stock')}>
                  View All <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Reorder</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStock.slice(0, 5).map((l) => (
                      <TableRow key={l.id} className="border-b-0">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-700">
                              <PackageX className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{l.product}</p>
                              <p className="text-[11px] text-muted-foreground">{l.sku}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{formatPieces(l.stock)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatPieces(l.reorderLevel)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={l.status === 'critical' ? 'danger' : 'warning'} dot>
                            {l.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="xl:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">Recent Activities</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="relative px-5 pb-5">
                  {activities.map((a, i) => {
                    const cfg = activityIcons[a.type]
                    return (
                      <div key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < activities.length - 1 ? (
                          <span className="absolute left-[15px] top-8 h-[calc(100%-28px)] w-px bg-border" />
                        ) : null}
                        <div className={cn('z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', cfg.className)}>
                          <cfg.icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-[13px] font-medium leading-snug text-foreground">{a.title}</p>
                          {a.detail ? <p className="text-[11.5px] text-muted-foreground">{a.detail}</p> : null}
                          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                            <span className="font-medium text-primary-700">by {a.actor}</span>
                            <span>·</span>
                            <span>{a.time}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {analytics.map((s) => (
              <AnalyticsCard key={s.label} stat={s} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const formatNumber = (v: number) => v.toLocaleString('en-IN')

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom'

interface DateRange {
  start: string
  end: string
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
]

function toISODate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function parseISODate(value: string) {
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function defaultRange(): DateRange {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  return { start: toISODate(start), end: toISODate(end) }
}

function periodRangeLabel(key: PeriodKey, range?: DateRange) {
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short', day: '2-digit', year: 'numeric' })
  if (key === 'custom' && range) {
    const s = parseISODate(range.start)
    const e = parseISODate(range.end)
    if (s && e) return `${fmt(s)} - ${fmt(e)}`
    return 'Custom Range'
  }
  const end = new Date()
  const start = new Date(end)
  if (key === 'today') return fmt(end)
  if (key === 'week') {
    start.setDate(end.getDate() - 6)
    return `${fmt(start)} - ${fmt(end)}`
  }
  if (key === 'month') {
    start.setDate(1)
    return `${fmt(start)} - ${fmt(end)}`
  }
  start.setMonth(end.getMonth() - 11, 1)
  start.setTime(new Date(end.getFullYear(), 0, 1).getTime())
  return `${fmt(start)} - ${fmt(end)}`
}

function PeriodSelect({
  value,
  onChange,
  range,
  onRangeChange,
  variant,
  align = 'right',
}: {
  value: PeriodKey
  onChange: (next: PeriodKey) => void
  range?: DateRange
  onRangeChange?: (next: DateRange) => void
  variant: 'pill' | 'range'
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [draft, setDraft] = useState<DateRange>(range ?? defaultRange())

  const selected = PERIODS.find((p) => p.key === value) ?? PERIODS[1]
  const display =
    variant === 'range' ? periodRangeLabel(value, range) : value === 'custom' ? 'Custom Range' : selected.label

  const openPanel = () => {
    setDraft(range ?? defaultRange())
    setCustomMode(value === 'custom')
    setOpen(true)
  }

  const applyCustom = () => {
    const s = parseISODate(draft.start)
    const e = parseISODate(draft.end)
    if (!s || !e || e < s) return
    onRangeChange?.(draft)
    onChange('custom')
    setOpen(false)
  }

  const rangeValid = (() => {
    const s = parseISODate(draft.start)
    const e = parseISODate(draft.end)
    return Boolean(s && e && e >= s)
  })()

  return (
    <div className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted',
          variant === 'range' && 'text-[12.5px]',
        )}
      >
        {variant === 'range' ? <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {display}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute top-8 z-20 min-w-[150px] animate-scale-in rounded-md border bg-popover p-1 shadow-popover',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {customMode ? (
              <div className="w-60 p-1.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Custom Range</p>
                  <button
                    onClick={() => setCustomMode(false)}
                    className="text-[11px] font-medium text-primary-700 hover:underline"
                  >
                    Presets
                  </button>
                </div>
                <label className="mb-1 block text-[11px] text-muted-foreground">From</label>
                <input
                  type="date"
                  value={draft.start}
                  onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                  className="mb-2 h-7 w-full rounded-md border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <label className="mb-1 block text-[11px] text-muted-foreground">To</label>
                <input
                  type="date"
                  value={draft.end}
                  max={toISODate(new Date())}
                  onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                  className="h-7 w-full rounded-md border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyCustom}
                    disabled={!rangeValid}
                    className="rounded-sm bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : (
              <>
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      onChange(p.key)
                      setOpen(false)
                    }}
                    className={cn(
                      'block w-full rounded-sm px-2.5 py-1.5 text-left text-[13px]',
                      value === p.key ? 'bg-primary-50 font-medium text-primary-700' : 'hover:bg-muted',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => setCustomMode(true)}
                  className={cn(
                    'block w-full rounded-sm px-2.5 py-1.5 text-left text-[13px]',
                    value === 'custom' ? 'bg-primary-50 font-medium text-primary-700' : 'hover:bg-muted',
                  )}
                >
                  Custom Range
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function AnalyticsCard({ stat }: { stat: AnalyticsStat }) {
  return (
    <Card className="p-4 shadow-kpi">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
      <p className="mt-1.5 text-base font-bold tabular-nums text-foreground">{stat.value}</p>
      {stat.trend ? (
        <span
          className={cn(
            'mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold',
            stat.trend === 'up' ? 'text-success-700' : 'text-red-600 dark:text-red-400',
          )}
        >
          {stat.trend === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {stat.delta}
        </span>
      ) : (
        <span className="mt-1 block text-[11px] text-muted-foreground">At current silver rate</span>
      )}
    </Card>
  )
}

function ConnectionBanner({ rate, shopifyStatus }: { rate: number | null; shopifyStatus: ShopifyStatus | null }) {
  const lastSyncAt = shopifyStatus
    ? Object.values(shopifyStatus.lastSync ?? {})
        .filter(Boolean)
        .sort()
        .pop() ?? null
    : null
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 border-primary-100 bg-gradient-to-r from-primary-50/70 via-card to-card px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
          <Tag className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Silver Rate</p>
          <p className="text-sm font-bold text-foreground">{rate != null ? `₹${rate.toFixed(2)} / gm` : '—'}</p>
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <StatusPill healthy={Boolean(shopifyStatus?.configured)} label="Shopify" sublabel={shopifyStatus?.configured ? 'Connected' : 'Not configured'} />
      <StatusPill healthy label="System" sublabel="Healthy" />
      <div className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <CloudCog className="h-3.5 w-3.5 text-info-700" />
        Last sync: {lastSyncAt ? formatDateTime(lastSyncAt) : 'Never'}
      </div>
    </Card>
  )
}

function StatusPill({ healthy, label, sublabel }: { healthy: boolean; label: string; sublabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', healthy ? 'bg-success' : 'bg-destructive')} />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', healthy ? 'bg-success' : 'bg-destructive')} />
      </span>
      <div className="leading-tight">
        <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xs font-semibold text-foreground">{sublabel}</p>
      </div>
    </div>
  )
}

function QuickActions() {
  const { hasPermission } = useAuth()
  const filtered = quickActions.filter((a) => !a.module || hasPermission(a.module, 'view'))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filtered.map((a) => (
        <a
          key={a.label}
          href={a.path}
          onClick={(e) => {
            if (a.path === '#') e.preventDefault()
          }}
          className="group flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-[12.5px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary-50 hover:text-primary-700"
        >
          <a.icon className="h-3.5 w-3.5" />
          {a.label}
        </a>
      ))}
    </div>
  )
}

function OperationalStrip({ summary }: { summary: Record<string, string | number> }) {
  const items: { label: string; value: string; icon: LucideIcon; tint: string }[] = [
    { label: 'Total Products', value: `${summary.totalProducts}`, icon: Gem, tint: 'bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300' },
    { label: 'Total Customers', value: `${summary.totalCustomers}`, icon: Users, tint: 'bg-info-50 text-info-700' },
    { label: 'Total Suppliers', value: `${summary.totalSuppliers}`, icon: BuildingIcon, tint: 'bg-warning-50 text-warning-700' },
    { label: 'Total Stock (Qty)', value: `${formatNumber(Number(summary.totalStockQty))} pcs`, icon: Boxes, tint: 'bg-success-50 text-success-700' },
    { label: 'Total Stock (Wt)', value: formatWeight(Number(summary.totalStockWeight)), icon: ScaleIcon, tint: 'bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300' },
    { label: "Today's Expenses", value: compactCurrency(Number(summary.todayExpenses)), icon: Wallet, tint: 'bg-warning-50 text-warning-700' },
    { label: 'Pending Payments', value: compactCurrency(Number(summary.pendingPayments)), icon: Clock, tint: 'bg-red-50 text-red-600 dark:text-red-400' },
  ]
  return (
    <Card className="divide-y divide-border overflow-hidden">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {items.map((it, i) => (
          <div key={it.label} className={cn('flex items-center gap-2.5', i < items.length - 1 && 'xl:border-r xl:border-border/70 xl:pr-4')}>
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', it.tint)}>
              <it.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">{it.label}</p>
              <p className="truncate text-[13px] font-semibold tabular-nums text-foreground">{it.value}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const BuildingIcon = Landmark
const ScaleIcon = Boxes

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-lg" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-lg xl:col-span-1" />
        <Skeleton className="h-[320px] rounded-lg xl:col-span-1" />
        <Skeleton className="h-[320px] rounded-lg xl:col-span-1" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[260px] rounded-lg xl:col-span-1" />
        <Skeleton className="h-[260px] rounded-lg xl:col-span-1" />
        <Skeleton className="h-[260px] rounded-lg xl:col-span-1" />
      </div>
    </div>
  )
}
