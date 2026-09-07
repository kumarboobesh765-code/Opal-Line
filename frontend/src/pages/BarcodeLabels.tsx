import { useEffect, useMemo, useState } from 'react'
import { Barcode, Copy, Check, Gem, Printer, Search } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { dbApi } from '@/lib/api'
import { escapeHtml } from '@/lib/utils'
import type { Product } from '@/types'
import { formatCurrency, formatWeight } from '@/lib/format'
import { cn } from '@/lib/utils'

function BarcodeVisual({ value, className }: { value: string; className?: string }) {
  const bars = useMemo(() => {
    const seq = '211' + value + '232'
    const out: { width: number; black: boolean }[] = []
    for (let i = 0; i < seq.length; i++) {
      const digit = Number(seq[i]) || 1
      const width = 1 + ((digit + i) % 3) + (i % 2)
      out.push({ width, black: i % 2 === 0 })
    }
    return out
  }, [value])

  return (
    <div className={cn('flex h-14 items-stretch gap-[2px]', className)} aria-label={`Barcode ${value}`}>
      {bars.map((b, i) => (
        <span
          key={i}
          className={cn('h-full', b.black ? 'bg-foreground' : 'bg-transparent')}
          style={{ width: `${b.width}px` }}
        />
      ))}
    </div>
  )
}

export default function BarcodeLabelsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<Product | null>(null)
  const [copied, setCopied] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    dbApi.getProducts().then((p) => {
      setProducts(p)
      setSelected(p[0])
    }).catch(() => {})
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q),
    )
  }, [products, query])

  const copyBarcode = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected.barcode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const printLabel = (p: Product) => {
    const w = window.open('', '_blank', 'width=460,height=380')
    if (!w) return
    w.opener = null
    w.document.write(`
      <!doctype html><html><head><title>${p.sku} label</title><style>
        body{margin:0;font-family:Arial,sans-serif;color:#111}
        .wrap{padding:16px}
        .label{width:300px;padding:16px;border:2px dashed #94a3b8;border-radius:8px}
        .head{display:flex;justify-content:space-between;align-items:baseline}
        .head strong{font-size:14px}.head span{font-size:10px;color:#64748b}
        .rows{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px}
        .rows span{color:#64748b}.rows b{text-align:right}
        .code{font-family:'Courier New',monospace;font-size:15px;letter-spacing:4px;text-align:center;margin-top:6px}
        .foot{text-align:center;font-size:9px;color:#64748b;margin-top:8px}
      </style></head><body><div class="wrap">${labelHtml(p)}</div>
      <script>window.onload=function(){window.focus();window.print();}</script>
      </body></html>`)
    w.document.close()
  }

  const printAllLabels = (list: Product[]) => {
    const w = window.open('', '_blank', 'width=500,height=420')
    if (!w || list.length === 0) return
    w.opener = null
    w.document.write(`
      <!doctype html><html><head><title>Barcode labels</title><style>
        body{margin:0;font-family:Arial,sans-serif;color:#111}
        .wrap{padding:16px}
        .label{width:280px;display:inline-block;vertical-align:top;padding:12px;border:1px dashed #94a3b8;border-radius:8px;margin:8px}
        .head{display:flex;justify-content:space-between;align-items:baseline}
        .head strong{font-size:12px}.head span{font-size:9px;color:#64748b}
        .rows{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10px;margin-top:8px;border-top:1px solid #e2e8f0;padding-top:6px}
        .rows span{color:#64748b}.rows b{text-align:right}
        .code{font-family:'Courier New',monospace;font-size:12px;letter-spacing:3px;text-align:center;margin-top:4px}
        .foot{text-align:center;font-size:8px;color:#64748b;margin-top:6px}
      </style></head><body><div class="wrap">${list.map((p) => labelHtml(p)).join('')}</div>
      <script>window.onload=function(){window.focus();window.print();}</script>
      </body></html>`)
    w.document.close()
  }

  const barsFor = (value: string) => {
    const seq = '211' + value + '232'
    let html = ''
    for (let i = 0; i < seq.length; i++) {
      const digit = Number(seq[i]) || 1
      const width = 1 + ((digit + i) % 3) + (i % 2)
      html += `<span style="display:inline-block;height:42px;width:${width}px;background:${i % 2 === 0 ? '#111' : 'transparent'}"></span>`
    }
    return html
  }

  const labelHtml = (p: Product) => `
    <div class="label">
      <div class="head"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.sku)}</span></div>
      <div style="display:flex;gap:2px;height:42px;margin-top:14px">${barsFor(p.barcode)}</div>
      <div class="code">${escapeHtml(p.barcode)}</div>
      <div class="rows">
        <span>Net Weight</span><b>${p.netWeight ?? '—'} gm</b>
        <span>Silver Rate</span><b>₹${(p.silverRate ?? 0).toFixed(2)}/g</b>
        <span>Making Charge</span><b>₹${(p.makingCharge ?? 0).toFixed(2)}/g</b>
        <span>Price</span><b>₹${(p.sellingPrice ?? 0).toFixed(2)}</b>
      </div>
      <div class="foot">Opal Line · Opal &amp; Silver Co.</div>
    </div>`

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Barcode / Labels"
        subtitle="Search products and print barcode labels for jewellery packaging."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => selected && printLabel(selected)} disabled={!selected}>
              <Printer className="h-3.5 w-3.5" /> Print Selected
            </Button>
            <Button size="sm" onClick={() => printAllLabels(products)} disabled={products.length === 0}>
              <Printer className="h-4 w-4" /> Print All Labels
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Find Product</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name, SKU or scan barcode..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {query ? (
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {results.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">No products found</p>
                  ) : (
                    results.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelected(p)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                          selected?.id === p.id ? 'bg-primary-50 text-primary-700' : 'hover:bg-muted',
                        )}
                      >
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', selected?.id === p.id ? 'bg-primary-100 text-primary-700' : 'bg-muted text-muted-foreground')}>
                          <Gem className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{p.name}</p>
                          <p className="font-mono text-[10.5px] text-muted-foreground">{p.barcode}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Type a product name, SKU or barcode number to search.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent Labels</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-3">
                {products.slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={cn(
                      'rounded-md border p-2.5 text-left transition-colors',
                      selected?.id === p.id ? 'border-primary-300 bg-primary-50/60' : 'hover:bg-muted',
                    )}
                  >
                    <p className="truncate text-xs font-medium text-foreground">{p.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{p.sku}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Barcode className="h-4 w-4 text-primary" /> Label Preview
              </CardTitle>
              {selected ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={copyBarcode}>
                    {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy Barcode'}
                  </Button>
                  <Button size="sm" onClick={() => printLabel(selected)}>
                    <Printer className="h-3.5 w-3.5" /> Print Label
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {selected ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border-2 border-dashed border-primary-200 bg-background p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                          <Gem className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{selected.name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{selected.sku}</p>
                        </div>
                      </div>
                      <Badge variant="purple">92.5%</Badge>
                    </div>
                    <BarcodeVisual value={selected.barcode} className="mt-6" />
                    <p className="mt-2 text-center font-mono text-sm tracking-[0.25em] text-foreground">{selected.barcode}</p>
                    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 text-[12px]">
                      <span className="text-muted-foreground">Net Weight</span>
                      <span className="text-right font-medium tabular-nums">{formatWeight(selected.netWeight)}</span>
                      <span className="text-muted-foreground">Silver Rate</span>
                      <span className="text-right font-medium tabular-nums">₹{selected.silverRate?.toFixed(2) ?? '—'}/g</span>
                      <span className="text-muted-foreground">Making Charge</span>
                      <span className="text-right font-medium tabular-nums">₹{selected.makingCharge ?? '—'}/g</span>
                      <span className="text-muted-foreground">Price</span>
                      <span className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(selected.sellingPrice)}</span>
                    </div>
                    <p className="mt-4 text-center text-[11px] text-muted-foreground">Opal Line · Opal & Silver Co. · {selected.id}</p>
                  </div>

                  <div className="space-y-3">
                    <LabelSizeCard size="55 × 30 mm" count={1} note="Jewellery pouch label" />
                    <LabelSizeCard size="100 × 60 mm" count={2} note="Includes product details" />
                    <LabelSizeCard size="58 × 40 mm" count={3} note="Barcode + HSN tag" />
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={Barcode}
                  title="No product selected"
                  description="Search and select a product to preview its barcode label."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function LabelSizeCard({ size, count, note }: { size: string; count: number; note: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors hover:bg-muted/50">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground">{size}</p>
        <p className="truncate text-xs text-muted-foreground">{note}</p>
      </div>
      <Badge variant="outline">{count} labels</Badge>
    </div>
  )
}
