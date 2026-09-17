import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ScanLine, Save, Trash2, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { dbApi } from '@/lib/api'

interface ScannedItem {
  id: string
  name: string
  sku: string
  barcode: string | null
  systemStock: number | null
  counted: number
}

export default function StockCountPage() {
  const [items, setItems] = useState<ScannedItem[]>([])
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'set' | 'adjust'>('set')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const lookup = useCallback(async (rawCode: string) => {
    const c = rawCode.trim()
    if (!c) return
    setError('')
    try {
      const res = await dbApi.scanProduct(c)
      const p = res.data
      setItems((prev) => {
        const existing = prev.find((x) => x.id === p.id)
        if (existing) {
          // Same item scanned again → increment counted qty by 1
          return prev.map((x) => (x.id === p.id ? { ...x, counted: x.counted + 1 } : x))
        }
        return [
          ...prev,
          {
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            systemStock: p.stock,
            counted: 1,
          },
        ]
      })
      setCode('')
      inputRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
      setCode('')
      inputRef.current?.focus()
    }
  }, [])

  const submit = async () => {
    if (items.length === 0) return
    setSaving(true)
    setSavedMsg('')
    try {
      const res = await dbApi.applyStockCount(
        items.map((x) => ({ id: x.id, counted: x.counted })),
        mode
      )
      setSavedMsg(`Applied ${res.applied} item(s) (${mode === 'set' ? 'set stock' : 'adjust stock'}).`)
      setItems([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setSaving(false)
    }
  }

  const totalVariance = items.reduce((a, x) => a + (x.systemStock != null ? x.counted - x.systemStock : 0), 0)

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Scan Stock Count"
        subtitle="Scan barcodes with a scanner gun (or type SKU) to count stock quickly, then apply."
        actions={
          <Button onClick={() => void submit()} disabled={saving || items.length === 0}>
            <Save className="h-4 w-4" />
            Apply Count ({items.length})
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor="scan-input">Barcode / SKU</Label>
              <div className="relative mt-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="scan-input"
                  ref={inputRef}
                  className="pl-9 font-mono"
                  placeholder="Scan or type, press Enter…"
                  value={code}
                  autoComplete="off"
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void lookup(code)
                    }
                  }}
                />
              </div>
            </div>
            <div>
              <Label>Apply mode</Label>
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant={mode === 'set' ? 'default' : 'outline'} onClick={() => setMode('set')}>
                  Set stock
                </Button>
                <Button size="sm" variant={mode === 'adjust' ? 'default' : 'outline'} onClick={() => setMode('adjust')}>
                  Adjust (+/−)
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {savedMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/30">
              <CheckCircle2 className="h-4 w-4" />
              {savedMsg}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">System stock</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      Nothing scanned yet — scan an item to begin.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="text-sm font-medium">{x.name}</TableCell>
                      <TableCell className="font-mono text-xs">{x.sku}</TableCell>
                      <TableCell className="text-right text-sm">{x.systemStock ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          className="ml-auto h-8 w-20 text-right font-mono"
                          value={x.counted}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((y) => (y.id === x.id ? { ...y, counted: Math.max(0, Number(e.target.value) || 0) } : y))
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {x.systemStock == null ? (
                          <Badge variant="muted">—</Badge>
                        ) : x.counted === x.systemStock ? (
                          <Badge variant="success">OK</Badge>
                        ) : (
                          <Badge variant={x.counted > x.systemStock ? 'info' : 'warning'}>
                            {x.counted > x.systemStock ? '+' : ''}
                            {x.counted - x.systemStock}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setItems((prev) => prev.filter((y) => y.id !== x.id))}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {items.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {items.length} item(s) · total variance{' '}
              <span className={totalVariance < 0 ? 'font-semibold text-red-600' : totalVariance > 0 ? 'font-semibold text-emerald-600' : ''}>
                {totalVariance > 0 ? '+' : ''}
                {totalVariance}
              </span>{' '}
              pcs {mode === 'set' ? '(counted value replaces stock)' : '(counted value adds to stock)'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
