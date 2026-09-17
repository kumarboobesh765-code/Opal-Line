import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { shopifyApi, type SyncCompareRow } from '@/lib/api'

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'))

const stateBadge = (state: string) => {
  switch (state) {
    case 'both-diff':
      return <Badge variant="danger">Price + Stock</Badge>
    case 'price-diff':
      return <Badge variant="warning">Price</Badge>
    case 'stock-diff':
      return <Badge variant="warning">Stock</Badge>
    case 'local-only':
      return <Badge variant="info">Local only</Badge>
    case 'shopify-only':
      return <Badge variant="purple">Shopify only</Badge>
    default:
      return <Badge variant="success">In sync</Badge>
  }
}

type Filter = 'all' | 'diffs' | 'local-only' | 'shopify-only'

export default function SyncComparePage() {
  const [rows, setRows] = useState<SyncCompareRow[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('diffs')
  const [pulling, setPulling] = useState<string | null>(null)
  const [pullMsg, setPullMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await shopifyApi.compareProducts()
      setRows(res.rows)
      setSyncedAt(res.syncedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c = { diffs: 0, 'local-only': 0, 'shopify-only': 0, all: 0 }
    for (const r of rows) {
      c.all++
      if (r.state === 'local-only') c['local-only']++
      else if (r.state === 'shopify-only') c['shopify-only']++
      else if (r.state !== 'in-sync') c.diffs++
    }
    return c
  }, [rows])

  const visible = useMemo(() => {
    if (filter === 'diffs') return rows.filter((r) => !['in-sync', 'local-only', 'shopify-only'].includes(r.state))
    if (filter === 'all') return rows
    return rows.filter((r) => r.state === filter)
  }, [rows, filter])

  const pull = async (row: SyncCompareRow) => {
    if (!row.localId) return
    setPulling(row.localId)
    setPullMsg(null)
    try {
      const res = await shopifyApi.pullProduct(row.localId)
      setPullMsg({ ok: true, text: `Pulled ${row.sku}: price ₹${fmt(res.pulled?.price ?? null)}, stock ${fmt(res.pulled?.stock ?? null)}` })
      await load()
    } catch (e) {
      setPullMsg({ ok: false, text: e instanceof Error ? e.message : 'Pull failed' })
    } finally {
      setPulling(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Product Sync Compare"
        subtitle="Side-by-side local vs Shopify prices & stock, matched by SKU."
        actions={
          <Button onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            Refresh comparison
          </Button>
        }
      />

      {syncedAt && (
        <p className="text-xs text-muted-foreground">Shopify catalog fetched {new Date(syncedAt).toLocaleString()}</p>
      )}

      {pullMsg && (
        <div className={`rounded-lg border p-3 text-sm font-medium ${pullMsg.ok ? 'border-success-200 bg-success-50 text-success-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {pullMsg.text}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-5 text-sm text-red-600">{error}</CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['diffs', `Differences (${counts.diffs})`],
            ['local-only', `Local only (${counts['local-only']})`],
            ['shopify-only', `Shopify only (${counts['shopify-only']})`],
            ['all', `All (${counts.all})`],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <Button key={key} size="sm" variant={filter === key ? 'default' : 'outline'} onClick={() => setFilter(key)}>
            {label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Comparing catalogs…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing here — everything matches.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Local ₹</TableHead>
                    <TableHead className="text-right">Shopify ₹</TableHead>
                    <TableHead className="text-right">Δ Price</TableHead>
                    <TableHead className="text-right">Local stock</TableHead>
                    <TableHead className="text-right">Shopify stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.localId || `shop-${r.shopifyId}`}>
                      <TableCell className="font-mono text-xs">{r.sku || '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm">{r.name}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.localPrice)}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.shopifyPrice)}</TableCell>
                      <TableCell className={`text-right text-sm font-medium ${r.priceDelta && r.priceDelta !== 0 ? 'text-amber-600' : ''}`}>
                        {r.priceDelta == null ? '—' : r.priceDelta > 0 ? `+${fmt(r.priceDelta)}` : fmt(r.priceDelta)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.localStock)}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.shopifyStock)}</TableCell>
                      <TableCell>{stateBadge(r.state)}</TableCell>
                      <TableCell className="text-right">
                        {r.localId && r.shopifyId && !['in-sync'].includes(r.state) ? (
                          <Button size="sm" variant="outline" onClick={() => void pull(r)} disabled={pulling === r.localId}>
                            <ArrowDownUp className="h-3 w-3" />
                            {pulling === r.localId ? 'Pulling…' : 'Pull'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
