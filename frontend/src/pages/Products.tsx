import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import {
  Download,
  Gem,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react'
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
import { ProductDialog } from '@/components/product-dialog'
import { dbApi, shopifyApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { Product } from '@/types'
import { formatCurrency, formatWeight } from '@/lib/format'
import { cn, safeImageUrl } from '@/lib/utils'

const API_ORIGIN = (import.meta.env.VITE_API_BASE ?? '').replace(/\/api\/v1$/, '') || ''

/** First usable image for a product: primary image or first gallery entry. */
export function productImageSrc(p: { image?: string | null; images?: string[] | null }): string | undefined {
  const candidates = [p.image, ...(p.images ?? [])].filter(Boolean) as string[]
  for (const c of candidates) {
    const remote = safeImageUrl(c)
    if (remote) return remote
    if (c.startsWith('/uploads/')) return `${API_ORIGIN}${c}`
  }
  return undefined
}

const shopifyVariant: Record<NonNullable<Product['shopifyStatus']>, { label: string; variant: 'success' | 'warning' | 'muted' | 'danger' }> = {
  synced: { label: 'Synced', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  'not-listed': { label: 'Not Listed', variant: 'muted' },
  error: { label: 'Error', variant: 'danger' },
}

const statusVariant: Record<NonNullable<Product['status']>, 'success' | 'muted' | 'warning'> = {
  active: 'success',
  inactive: 'muted',
  draft: 'warning',
}

const PURE = '#7c3aed'
const GREEN = '#16a34a'
const ORANGE = '#f59e0b'
const RED = '#ef4444'

const productTints: Record<string, { bg: string; text: string }> = {
  'Silver Classic Ring': { bg: 'bg-primary-50', text: 'text-primary-700' },
  'Silver Bracelet': { bg: 'bg-info-50', text: 'text-info-700' },
  'Silver Chain': { bg: 'bg-success-50', text: 'text-success-700' },
  'Silver Pendant': { bg: 'bg-warning-50', text: 'text-warning-700' },
  'Silver Earrings': { bg: 'bg-red-50', text: 'text-red-600' },
}

export default function ProductsPage() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')
  const [pushMessage, setPushMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [purity, setPurity] = useState('')
  const [stockStatus, setStockStatus] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const load = () => {
    setLoading(true)
    setError('')
    dbApi
      .getProducts()
      .then((p) => {
        setProducts(p)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not load products')
        setLoading(false)
      })
  }

  useEffect(load, [])

  const syncShopify = async () => {
    setSyncing(true)
    setError('')
    setPushMessage(null)
    try {
      const result = await shopifyApi.syncProductsToDb()
      if (result.ok) {
        setPushMessage({
          ok: true,
          text: `Synced ${result.synced} live products from Shopify — ${result.created} created, ${result.updated} updated, ${result.removed} removed.`,
        })
      } else {
        setPushMessage({ ok: false, text: result.errors[0] ?? 'Shopify sync failed' })
      }
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Shopify sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const pushProducts = async (ids?: string[]) => {
    setPushing(true)
    setError('')
    setPushMessage(null)
    try {
      const result = await shopifyApi.pushProducts(ids)
      if (result.created > 0) {
        setPushMessage({ ok: true, text: `Pushed ${result.created} product${result.created === 1 ? '' : 's'} to Shopify.` })
      } else {
        setPushMessage({ ok: result.errors.length === 0, text: result.errors.length > 0 ? `Push failed: ${result.errors[0]}` : 'Nothing new to push — all products are already listed on Shopify.' })
      }
      if (result.created > 0) load()
    } catch (e) {
      setPushMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not reach the backend server' })
    } finally {
      setPushing(false)
    }
  }

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const q = query.trim().toLowerCase()
      const matchQuery = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      const matchCategory = !category || p.category === category
      const matchPurity = !purity || String(p.purity) === purity
      const matchStock =
        !stockStatus ||
        (stockStatus === 'low' && (p.stock ?? 0) <= (p.reorderLevel ?? 0)) ||
        (stockStatus === 'out' && (p.stock ?? 0) === 0) ||
        (stockStatus === 'ok' && (p.stock ?? 0) > (p.reorderLevel ?? 0))
      return matchQuery && matchCategory && matchPurity && matchStock
    })
  }, [products, query, category, purity, stockStatus])

  const toggleStatus = async (p: Product) => {
    const next = p.status === 'inactive' ? 'active' : 'inactive'
    try {
      await dbApi.update('products', p.id, { status: next })
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
    } catch (e) {
      setPushMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not update product' })
    }
  }

  const duplicateProduct = async (p: Product) => {
    try {
      await dbApi.create('products', {
        name: `${p.name} (Copy)`,
        sku: `${p.sku}-COPY`,
        barcode: p.barcode ?? '',
        category: p.category,
        collection: p.collection ?? '',
        purity: p.purity ?? '92.5',
        supplier: p.supplier ?? '',
        grossWeight: p.grossWeight ?? null,
        stoneWeight: p.stoneWeight ?? null,
        netWeight: p.netWeight ?? null,
        makingCharge: p.makingCharge ?? null,
        gst: p.gst ?? null,
        silverRate: p.silverRate ?? null,
        sellingPrice: p.sellingPrice ?? null,
        compareAtPrice: p.compareAtPrice ?? null,
        stock: p.stock ?? null,
        reorderLevel: p.reorderLevel ?? null,
        vendor: p.vendor ?? '',
        productType: p.productType ?? '',
        tags: p.tags ?? '',
        image: p.image ?? '',
        trackInventory: p.trackInventory ?? false,
        chargeOnTax: p.chargeOnTax ?? true,
        status: 'draft',
        shopifyStatus: 'not-listed',
      })
      setPushMessage({ ok: true, text: `Duplicated "${p.name}" as a new draft product.` })
      load()
    } catch (e) {
      setPushMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not duplicate product' })
    }
  }

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Product',
        meta: { headerClassName: 'min-w-[220px]' },
        cell: ({ row }) => {
          const tint = productTints[row.original.name] ?? { bg: 'bg-muted', text: 'text-muted-foreground' }
          return (
            <Link
              to={`/inventory/products/${row.original.id}`}
              className="group flex items-center gap-2.5"
            >
              {productImageSrc(row.original) ? (
                <img
                  src={productImageSrc(row.original)}
                  alt={row.original.name}
                  className="h-8 w-8 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', tint.bg, tint.text)}>
                  <Gem className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground group-hover:text-primary-700">{row.original.name}</p>
                <p className="text-[11px] text-muted-foreground">{row.original.sku}</p>
              </div>
            </Link>
          )
        },
      },
      { accessorKey: 'purity', header: 'Purity', cell: ({ row }) => <span className="tabular-nums">{row.original.purity != null ? `${row.original.purity}%` : '—'}</span>, meta: { align: 'right' as const } },
      { accessorKey: 'collection', header: 'Collection', cell: ({ row }) => <Badge variant="outline">{row.original.collection ?? '—'}</Badge> },
      { accessorKey: 'netWeight', header: 'Net Wt', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatWeight(row.original.netWeight)}</span>, meta: { align: 'right' as const } },
      { accessorKey: 'makingCharge', header: 'Making', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.makingCharge != null ? `${row.original.makingCharge} ₹/g` : '—'}</span>, meta: { align: 'right' as const } },
      { accessorKey: 'silverRate', header: 'Silver Rate', cell: ({ row }) => <span className="tabular-nums text-muted-foreground">₹{row.original.silverRate?.toFixed(2) ?? '—'}/g</span>, meta: { align: 'right' as const } },
      { accessorKey: 'sellingPrice', header: 'Selling Price', cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.sellingPrice)}</span>, meta: { align: 'right' as const } },
      { accessorKey: 'stock', header: 'Stock', cell: ({ row }) => <span className={cn('font-medium tabular-nums', (row.original.stock ?? 0) <= (row.original.reorderLevel ?? 0) ? 'text-red-600' : 'text-foreground')}>{row.original.stock ?? 0} pcs</span>, meta: { align: 'right' as const } },
      {
        id: 'shopify',
        header: 'Shopify',
        cell: ({ row }) => {
          const s = shopifyVariant[row.original.shopifyStatus ?? 'not-listed'] ?? { label: 'Not Listed', variant: 'muted' as const }
          return <Badge variant={s.variant} dot>{s.label}</Badge>
        },
        meta: { align: 'center' as const },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <Badge variant={statusVariant[row.original.status ?? 'active'] ?? 'muted'}>{row.original.status ?? '—'}</Badge>,
        meta: { align: 'center' as const },
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
                <Link to={`/inventory/products/${row.original.id}`} className="flex w-full">View / Edit</Link>
              </DropdownMenuItem>
              {row.original.shopifyStatus !== 'synced' ? (
                <DropdownMenuItem onClick={() => pushProducts([row.original.id])}>
                  Push to Shopify
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => duplicateProduct(row.original)}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/inventory/barcode')}>Print Label</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => toggleStatus(row.original)}>
                {row.original.status === 'inactive' ? 'Activate' : 'Deactivate'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [pushProducts],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 sm:space-y-5 sm:py-6 lg:px-6">
      <PageHeader
        title="Products"
        subtitle="Manage jewellery products, pricing, inventory and Shopify synchronization."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => pushProducts()} disabled={pushing || syncing}>
              <Upload className={cn('h-3.5 w-3.5', pushing && 'animate-pulse')} /> <span className="hidden sm:inline">{pushing ? 'Pushing...' : 'Push to Shopify'}</span><span className="sm:hidden">Push</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportTable('products.csv', columns, filtered)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={syncShopify} disabled={syncing}>
              <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Sync Live Products'}</span><span className="sm:hidden">Sync</span>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        }
      />

      <ProductDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="add"
        onSaved={(product, pushed) => {
          setPushMessage(pushed
            ? { ok: true, text: `Created "${product.name}" and pushed to Shopify.` }
            : { ok: true, text: `Created "${product.name}".` })
          load()
        }}
      />

      {error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 block h-2 w-2 shrink-0 rounded-full bg-red-600" />
          <p>{error}. Start the backend with <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs">npm run dev --prefix backend</code>.</p>
        </div>
      ) : null}

      {pushMessage ? (
        <div className={cn('flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm', pushMessage.ok ? 'border-success-100 bg-success-50/60 text-success-700' : 'border-red-200 bg-red-50/60 text-red-700')}>
          <span className={cn('mt-0.5 block h-2 w-2 shrink-0 rounded-full', pushMessage.ok ? 'bg-success-600' : 'bg-red-600')} />
          <p>{pushMessage.text}</p>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-0 flex-1 sm:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search product name, SKU, barcode..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                options={[
                  { value: '', label: 'All Categories' },
                  { value: 'Rings', label: 'Rings' },
                  { value: 'Chains', label: 'Chains' },
                  { value: 'Bracelets', label: 'Bracelets' },
                  { value: 'Earrings', label: 'Earrings' },
                  { value: 'Pendants', label: 'Pendants' },
                  { value: 'Mangalsutra', label: 'Mangalsutra' },
                  { value: 'Anklets', label: 'Anklets' },
                ]}
                value={category}
                onValueChange={setCategory}
                className="w-full sm:w-[150px]"
              />
              <Select
                options={[
                  { value: '', label: 'All Purity' },
                  { value: '92.5', label: '92.5% Sterling' },
                  { value: '99.9', label: '99.9% Fine' },
                ]}
                value={purity}
                onValueChange={setPurity}
                className="w-[calc(50%-4px)] sm:w-[130px]"
              />
              <Select
                options={[
                  { value: '', label: 'All Stock' },
                  { value: 'ok', label: 'In Stock' },
                  { value: 'low', label: 'Low Stock' },
                  { value: 'out', label: 'Out of Stock' },
                ]}
                value={stockStatus}
                onValueChange={setStockStatus}
                className="w-[calc(50%-4px)] sm:w-[130px]"
              />
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">{filtered.length}</span> of {products.length} products
              </span>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No products match your filters"
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground sm:gap-4">
        <LegendSwatch color={GREEN} label="Shopify synced" />
        <LegendSwatch color={ORANGE} label="Pending approval" />
        <LegendSwatch color={RED} label="Sync error" />
        <div className="ml-auto flex flex-wrap items-center gap-3 sm:gap-4">
          <span className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-primary" /> {products.length} products</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Silver rate applied: ₹{products[0]?.silverRate?.toFixed(2) ?? '—'} / gm
          </span>
        </div>
      </div>
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

export { PURE, GREEN, ORANGE, RED }
