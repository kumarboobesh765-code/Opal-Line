import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ScanBarcode,
  Search,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dbApi, shopifyApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { Customer, OrderStatus, Product, SalesOrder } from '@/types'
import { formatCurrency, formatDate, formatDateTime, todayIST } from '@/lib/format'

const statusMeta: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'info' | 'purple' }> = {
  imported: { label: 'Imported', variant: 'info' },
  confirmed: { label: 'Confirmed', variant: 'purple' },
  processing: { label: 'Processing', variant: 'warning' },
  fulfilled: { label: 'Fulfilled', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
  returned: { label: 'Returned', variant: 'warning' },
  refunded: { label: 'Refunded', variant: 'muted' },
}

const paymentMeta: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' | 'info' }> = {
  paid: { label: 'Paid', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  cod: { label: 'COD', variant: 'warning' },
  bank: { label: 'Bank Transfer', variant: 'info' },
  refunded: { label: 'Refunded', variant: 'muted' },
  Online: { label: 'Paid', variant: 'success' },
  online: { label: 'Paid', variant: 'success' },
  partially_paid: { label: 'Partial', variant: 'warning' },
  partially_refunded: { label: 'Partial Refund', variant: 'info' },
  voided: { label: 'Voided', variant: 'muted' },
}

function getPaymentMeta(val: string) {
  return paymentMeta[val] ?? { label: val || 'Unknown', variant: 'muted' as const }
}

const fulfillmentMeta: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' | 'info' }> = {
  unfulfilled: { label: 'Unfulfilled', variant: 'muted' },
  pending: { label: 'Unfulfilled', variant: 'muted' },
  partial: { label: 'Partial', variant: 'warning' },
  fulfilled: { label: 'Fulfilled', variant: 'success' },
  processing: { label: 'Processing', variant: 'warning' },
  returned: { label: 'Returned', variant: 'muted' },
  restocked: { label: 'Restocked', variant: 'info' },
}

function getFulfillmentMeta(val: string) {
  return fulfillmentMeta[val] ?? { label: val || 'Unknown', variant: 'muted' as const }
}

interface OrderLineItem {
  key: string
  productId: string
  title: string
  sku: string
  qty: number
  price: number
}

interface CreateResult {
  order: SalesOrder
  shopifySync: { ok: boolean; draftId?: string; name?: string; completed?: boolean; errors: string[]; message?: string } | null
}

interface OrderAddress {
  name: string
  phone: string
  address1: string
  city: string
  province: string
  zip: string
  country: string
}

function emptyAddress(): OrderAddress {
  return { name: '', phone: '', address1: '', city: '', province: '', zip: '', country: '' }
}

function hasAddress(a: OrderAddress): boolean {
  return Boolean(
    a.name.trim() ||
      a.phone.trim() ||
      a.address1.trim() ||
      a.city.trim() ||
      a.province.trim() ||
      a.zip.trim() ||
      a.country.trim(),
  )
}

function toAddressPayload(a: OrderAddress, fallbackName: string): Record<string, string> | undefined {
  const name = a.name.trim() || fallbackName.trim()
  const out: Record<string, string> = {}
  if (name) out.name = name
  if (a.phone.trim()) out.phone = a.phone.trim()
  if (a.address1.trim()) out.address1 = a.address1.trim()
  if (a.city.trim()) out.city = a.city.trim()
  if (a.province.trim()) out.province = a.province.trim()
  if (a.zip.trim()) out.zip = a.zip.trim()
  if (a.country.trim()) out.country = a.country.trim()
  return Object.keys(out).length ? out : undefined
}

let lineSeq = 0

function emptyLine(): OrderLineItem {
  return { key: `li-${++lineSeq}`, productId: '', title: '', sku: '', qty: 1, price: 0 }
}

export default function SalesOrdersPage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [created, setCreated] = useState<CreateResult | null>(null)
  const [editing, setEditing] = useState<SalesOrder | null>(null)

  const [customerSel, setCustomerSel] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [billingAddr, setBillingAddr] = useState<OrderAddress>(emptyAddress())
  const [shippingAddr, setShippingAddr] = useState<OrderAddress>(emptyAddress())
  const [sameAsBilling, setSameAsBilling] = useState(true)
  const [orderDate, setOrderDate] = useState(todayIST())
  const [payment, setPayment] = useState('paid')
  const [fulfillment, setFulfillment] = useState('unfulfilled')
  const [orderStatus, setOrderStatus] = useState('confirmed')
  const [note, setNote] = useState('')
  const [syncToShopify, setSyncToShopify] = useState(true)
  const [lineItems, setLineItems] = useState<OrderLineItem[]>([emptyLine()])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const [viewOrder, setViewOrder] = useState<SalesOrder | null>(null)
  const [invoiceSavingId, setInvoiceSavingId] = useState<string | null>(null)
  const [syncingOrders, setSyncingOrders] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const reload = useCallback(() => {
    dbApi.getSalesOrders().then(setOrders).catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([dbApi.getSalesOrders(), dbApi.getCustomers(), dbApi.getProducts()])
      .then(([o, c, p]) => {
        setOrders(o)
        setCustomers(c)
        setProducts(p)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const cancelOrder = useCallback(async (o: SalesOrder) => {
    if (!window.confirm(`Cancel order ${o.shopifyId}?`)) return
    try {
      await dbApi.update('sales-orders', o.id, { status: 'cancelled' })
      setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: 'cancelled' } : x)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not cancel order')
    }
  }, [])

  const createInvoiceFor = useCallback(
    async (o: SalesOrder) => {
      if (invoiceSavingId) return
      setInvoiceSavingId(o.id)
      try {
        const settings = await dbApi.getSettings().catch(() => null)
        const gst = settings?.gstRate ?? 3
        // Customer snapshot: prefer the customer record (email/phone), fall back to
        // the order's own shipping/billing address for contact + full address block.
        const addr = (o.shippingAddress && (o.shippingAddress.address1 || o.shippingAddress.city)) ? o.shippingAddress : (o.billingAddress ?? undefined)
        const fmtAddr = addr
          ? [addr.address1, addr.address2].filter(Boolean).join(', ')
          : ''
        const customer = customers.find((c) => c.name === o.customer)
          ?? customers.find((c) => c.email && o.shippingAddress && (o.shippingAddress as any).phone && c.phone === (o.shippingAddress as any).phone)
          ?? null
        const items = (o.lineItems ?? [])
          .map((li) => {
            const qty = Number(li.quantity ?? 0)
            const price = Number(li.price ?? 0)
            const amount = Math.round(price * qty * 100) / 100
            return {
              product: String(li.title ?? '').trim(),
              sku: String(li.sku ?? ''),
              qty,
              weight: 0,
              silverRate: 0,
              makingCharge: 0,
              tax: Math.round((amount * gst) / 100 * 100) / 100,
              amount,
            }
          })
          .filter((it) => it.product !== '' && it.qty > 0)
        const subtotal = Math.round(items.reduce((a, it) => a + it.amount, 0) * 100) / 100
        const gstAmount = Math.round((subtotal * gst) / 100 * 100) / 100
        const discount = Math.round(Number(o.discount ?? 0) * 100) / 100
        const grandTotal = Math.round((subtotal + gstAmount - discount) * 100) / 100
        const number = `INV-${todayIST().replace(/-/g, '')}${Math.floor(1000 + Math.random() * 9000)}`
        const inv = await dbApi.create('invoices', {
          number,
          shopifyOrder: o.shopifyId,
          customer: o.customer,
          customerEmail: customer?.email ?? '',
          customerPhone: customer?.phone ?? (addr as any)?.phone ?? '',
          customerAddress: fmtAddr || (addr as any)?.address1 || '',
          customerCity: (addr as any)?.city ?? customer?.city ?? '',
          customerState: (addr as any)?.province ?? customer?.province ?? '',
          customerPincode: (addr as any)?.zip ?? '',
          silverValue: 0,
          makingCharge: 0,
          subtotal,
          gst,
          gstAmount,
          discount,
          grandTotal,
          paymentMethod: o.payment === 'paid' ? 'Online' : 'Pending',
          paymentStatus: o.payment,
          status: o.payment === 'paid' ? 'paid' : 'issued',
          date: new Date().toISOString(),
          items,
        })
        await dbApi.update('sales-orders', o.id, { invoice: number })
        setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, invoice: number } : x)))
        navigate(`/sales/invoices/${inv.id}`)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Could not create invoice')
      } finally {
        setInvoiceSavingId(null)
      }
    },
    [navigate, invoiceSavingId, customers],
  )

  const viewOnShopify = useCallback(async (o: SalesOrder) => {
    try {
      const s = await shopifyApi.getStatus()
      if (!s.store) {
        window.alert('Shopify is not configured.')
        return
      }
      const base = `https://${s.store}.myshopify.com/admin`
      const query = encodeURIComponent(o.shopifyId.replace(/^#/, ''))
      window.open(`${base}/orders?query=${query}`, '_blank', 'noopener')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not open Shopify')
    }
  }, [])

  const syncOrders = async () => {
    setSyncingOrders(true)
    setSyncMsg(null)
    try {
      const res = await shopifyApi.syncOrders()
      if (res.ok) {
        setSyncMsg({
          ok: true,
          text: `Synced Shopify orders: ${res.imported} new, ${res.updated} updated.`,
        })
        reload()
      } else {
        setSyncMsg({ ok: false, text: res.message ?? res.errors[0] ?? 'Shopify order sync failed.' })
      }
    } catch (err) {
      setSyncMsg({ ok: false, text: err instanceof Error ? err.message : 'Shopify order sync failed.' })
    } finally {
      setSyncingOrders(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((o) => {
      const matchQ =
        !q ||
        o.shopifyId.toLowerCase().includes(q) ||
        o.internalId.toLowerCase().includes(q) ||
        o.customer.toLowerCase().includes(q)
      const matchS = !status || o.status === status
      return matchQ && matchS
    })
  }, [orders, query, status])

  const startEdit = (o: SalesOrder) => {
    setEditing(o)
    setFormError('')
    setCreated(null)
    const c = customers.find((x) => x.name === o.customer)
    setCustomerSel(c ? c.name : '__new__')
    setCustomerName(o.customer)
    setCustomerEmail(c?.email ?? '')
    setCustomerPhone(c?.phone ?? '')
    setBillingAddr(o.billingAddress && typeof o.billingAddress === 'object' ? { ...emptyAddress(), ...(o.billingAddress as Record<string, string>) } : emptyAddress())
    setShippingAddr(o.shippingAddress && typeof o.shippingAddress === 'object' ? { ...emptyAddress(), ...(o.shippingAddress as Record<string, string>) } : emptyAddress())
    setSameAsBilling(!o.shippingAddress)
    setOrderDate(String(o.date).slice(0, 10))
    setPayment(o.payment)
    setFulfillment(o.fulfillment)
    setOrderStatus(o.status)
    setNote('')
    setSyncToShopify(Boolean(o.shopifyId && o.shopifyId.startsWith('#')))
    setLineItems(
      o.lineItems && o.lineItems.length > 0
        ? o.lineItems.map((li) => ({ key: crypto.randomUUID(), productId: '', title: li.title, sku: li.sku ?? '', qty: li.quantity, price: li.price }))
        : [emptyLine()],
    )
    setDialogOpen(true)
  }

  const columns = useMemo<ColumnDef<SalesOrder>[]>(
    () => [
      {
        accessorKey: 'shopifyId',
        header: 'Shopify Order',
        meta: { headerClassName: 'min-w-[170px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-info-50 text-info-700">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div>
              <p className="font-mono font-medium text-foreground">{row.original.shopifyId}</p>
              <p className="text-[11px] text-muted-foreground">{row.original.internalId}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-foreground">{row.original.customer}</p>
            <p className="text-[11px] text-muted-foreground">{row.original.items} items · {formatDate(row.original.date)}</p>
          </div>
        ),
      },
      {
        accessorKey: 'value',
        header: 'Order Value',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.value)}</span>,
      },
      {
        id: 'payment',
        header: 'Payment',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const p = getPaymentMeta(row.original.payment)
          return <Badge variant={p.variant} dot>{p.label}</Badge>
        },
      },
      {
        id: 'fulfillment',
        header: 'Fulfillment',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const f = getFulfillmentMeta(row.original.fulfillment)
          return <Badge variant={f.variant}>{f.label}</Badge>
        },
      },
      {
        accessorKey: 'invoice',
        header: 'Invoice',
        cell: ({ row }) =>
          row.original.invoice ? (
            <button
              type="button"
              className="font-mono text-[12px] font-medium text-primary-700 hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                navigate('/sales/invoices')
              }}
            >
              {row.original.invoice}
            </button>
          ) : (
            <Badge variant="muted">Not raised</Badge>
          ),
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
              <DropdownMenuItem onClick={() => setViewOrder(row.original)}>
                <Eye className="h-3.5 w-3.5" /> View Order
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => startEdit(row.original)}>
                <Pencil className="h-3.5 w-3.5" /> Edit Order
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={Boolean(row.original.invoice) || invoiceSavingId === row.original.id}
                onClick={() => createInvoiceFor(row.original)}
              >
                {invoiceSavingId === row.original.id ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {row.original.invoice ? 'Invoice Raised' : 'Create Invoice'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => viewOnShopify(row.original)}>
                <ExternalLink className="h-3.5 w-3.5" /> View on Shopify
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => cancelOrder(row.original)}>Cancel Order</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [navigate, cancelOrder, createInvoiceFor, viewOnShopify, invoiceSavingId, startEdit],
  )

  const openDialog = () => {
    setEditing(null)
    setFormError('')
    setCreated(null)
    setCustomerSel('')
    setCustomerName('')
    setCustomerEmail('')
    setCustomerPhone('')
    setBillingAddr(emptyAddress())
    setShippingAddr(emptyAddress())
    setSameAsBilling(true)
    setOrderDate(todayIST())
    setPayment('paid')
    setFulfillment('unfulfilled')
    setOrderStatus('confirmed')
    setNote('')
    setSyncToShopify(true)
    setLineItems([emptyLine()])
    setDialogOpen(true)
  }

  const totalValue = useMemo(
    () => lineItems.reduce((acc, li) => acc + (Number.isFinite(li.price) ? li.price : 0) * (Number.isFinite(li.qty) ? li.qty : 0), 0),
    [lineItems],
  )

  const selectProduct = (key: string, productId: string) => {
    const p = products.find((x) => x.id === productId)
    setLineItems((prev) =>
      prev.map((li) =>
        li.key === key
          ? {
              ...li,
              productId,
              title: p?.name ?? li.title,
              sku: p?.sku ?? li.sku,
              price: p?.sellingPrice ?? li.price,
            }
          : li,
      ),
    )
  }

  // Barcode scan: scanners type the code and press Enter instantly, so a plain
  // input with an Enter handler works. Matches barcode first, then SKU (exact,
  // case-insensitive). Re-scanning the same item bumps its quantity.
  const handleBarcodeScan = () => {
    const code = barcodeInput.trim()
    if (!code) return
    const p = products.find((x) => (x.barcode && x.barcode.trim() === code) || x.sku.toLowerCase() === code.toLowerCase())
    setBarcodeInput('')
    if (!p) {
      setScanFeedback({ ok: false, text: `No product matches "${code}"` })
      return
    }
    setScanFeedback({ ok: true, text: `Added ${p.name}${p.sellingPrice ? ` · ₹${p.sellingPrice.toFixed(2)}` : ''}` })
    setLineItems((prev) => {
      const existing = prev.find((li) => li.productId === p.id)
      if (existing) {
        return prev.map((li) => (li.key === existing.key ? { ...li, qty: li.qty + 1 } : li))
      }
      // Fill the empty first line if it's untouched, otherwise append
      const firstEmpty = prev.length === 1 && !prev[0].productId && !prev[0].title
      if (firstEmpty) {
        return [{ ...prev[0], productId: p.id, title: p.name, sku: p.sku, price: p.sellingPrice ?? 0, qty: 1 }]
      }
      return [...prev, { key: crypto.randomUUID(), productId: p.id, title: p.name, sku: p.sku, qty: 1, price: p.sellingPrice ?? 0 }]
    })
  }

  const updateLineItem = (key: string, patch: Partial<OrderLineItem>) => {
    setLineItems((prev) => prev.map((li) => (li.key === key ? { ...li, ...patch } : li)))
  }

  const createOrder = async () => {
    const customer = customerSel === '__new__' ? customerName.trim() : customerSel
    if (!customer) {
      setFormError('Select a customer or enter a new customer name.')
      return
    }
    const items = lineItems
      .filter((li) => li.title.trim())
      .map((li) => ({ title: li.title.trim(), sku: li.sku, quantity: Math.max(0, Math.floor(li.qty) || 0), price: Number(li.price) || 0 }))
    if (!editing && items.length === 0) {
      setFormError('Add at least one line item.')
      return
    }
    const originalItems = editing?.lineItems ?? null
    const itemsChanged =
      originalItems === null
        ? items.length > 0
        : originalItems.length !== items.length ||
          originalItems.some((oi, i) => {
            const cur = items[i]
            return !cur || String(oi.title ?? '') !== cur.title || String(oi.sku ?? '') !== cur.sku || Number(oi.quantity ?? 0) !== cur.quantity || Number(oi.price ?? 0) !== cur.price
          })
    setSaving(true)
    setFormError('')
    try {
      const shared = hasAddress(billingAddr) ? billingAddr : shippingAddr
      const billing = customerSel === '__new__' ? toAddressPayload(shared, customerName) : undefined
      const shipping =
        customerSel === '__new__' ? (sameAsBilling ? billing : toAddressPayload(shippingAddr, customerName)) : undefined
      const common = {
        customer,
        email: customerEmail.trim() || undefined,
        phone: customerPhone.trim() || undefined,
        payment,
        fulfillment,
        status: orderStatus,
        date: orderDate ? new Date(orderDate).toISOString() : undefined,
        note: note.trim() || undefined,
        billingAddress: billing,
        shippingAddress: shipping,
        syncToShopify,
      }
      const res = editing
        ? await shopifyApi.updateOrder(editing.id, { ...common, ...(itemsChanged ? { items } : {}) })
        : await shopifyApi.createOrder({ ...common, items })
      setCreated(res)
      reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save order')
    } finally {
      setSaving(false)
    }
  }

  const customerOptions = customers.map((c) => ({
    value: c.name,
    label: c.name,
    keywords: `${c.email ?? ''} ${c.phone ?? ''}`.trim(),
    subtitle: [c.email, c.phone].filter(Boolean).join(' · ') || undefined,
  }))

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 lg:px-6">
      <PageHeader
        title="Sales Orders"
        subtitle="Shopify orders imported into the ERP — tracked through confirmation, fulfillment and invoicing."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportTable('sales-orders.csv', columns, filtered)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={syncOrders} disabled={syncingOrders}>
              {syncingOrders ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {syncingOrders ? 'Syncing...' : 'Sync Orders'}
            </Button>
            <Button size="sm" className="gap-1.5" onClick={openDialog}>
              <Plus className="h-4 w-4" /> Manual Order
            </Button>
          </>
        }
      />

      {syncMsg ? (
        <div
          className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
            syncMsg.ok
              ? 'border-success-100 bg-success-50/70 text-success-700'
              : 'border-red-200 bg-red-50/60 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            {syncMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
            {syncMsg.text}
          </span>
          <button
            type="button"
            onClick={() => setSyncMsg(null)}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search order ID, customer..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'imported', label: 'Imported' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'processing', label: 'Processing' },
                { value: 'fulfilled', label: 'Fulfilled' },
                { value: 'cancelled', label: 'Cancelled' },
                { value: 'returned', label: 'Returned' },
                { value: 'refunded', label: 'Refunded' },
              ]}
              value={status}
              onValueChange={setStatus}
              className="w-[150px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {orders.length} orders
            </div>
          </div>

          <DataTable
            onRowClick={(o) => setViewOrder(o)}
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No orders match your filters"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Order ${editing.shopifyId}` : 'Create Manual Order'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the order in the ERP. If syncing is on, Shopify is updated with the note, email and shipping address.'
                : 'Create an order in the ERP and push it to Shopify. The order is created on Shopify with the same payment status you select below.'}
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="flex min-h-0 flex-col items-center gap-3 overflow-y-auto py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-50 text-success-700">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <p className="text-base font-semibold text-foreground">{editing ? 'Order updated successfully' : 'Order created successfully'}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Order <span className="font-mono font-semibold text-foreground">{created.order.internalId}</span> for{' '}
                {created.order.customer} · {formatCurrency(created.order.value)}
              </p>
              {created.shopifySync ? (
                created.shopifySync.ok ? (
                  <div className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 text-xs font-medium text-success-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {editing
                      ? `Order updated on Shopify (${created.order.shopifyId})`
                      : created.shopifySync.completed
                        ? `Order created on Shopify as ${created.shopifySync.name}`
                        : `Synced to Shopify as draft ${created.shopifySync.name}`}
                  </div>
                ) : (
                  <div className="flex w-full max-w-sm items-start gap-2 rounded-lg border border-warning-100 bg-warning-50/70 px-3 py-2 text-left text-xs text-warning-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {editing ? 'Order updated locally, but Shopify sync failed: ' : 'Order saved locally, but Shopify sync failed: '}
                      {created.shopifySync.message ?? created.shopifySync.errors[0] ?? 'Unknown error'}
                    </span>
                  </div>
                )
              ) : null}
              <Button className="mt-2" onClick={() => setDialogOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</Label>
                    <span className="text-[11px] text-muted-foreground">Pick an existing customer or add a new one</span>
                  </div>
                  <SearchableSelect
                    placeholder="Select customer"
                    searchPlaceholder="Search customers..."
                    options={[...customerOptions, { value: '__new__', label: 'New customer…' }]}
                    value={customerSel}
                    onValueChange={(v) => {
                      setCustomerSel(v)
                      if (v !== '__new__') {
                        const c = customers.find((x) => x.name === v)
                        setCustomerEmail(c?.email ?? '')
                        setCustomerPhone(c?.phone ?? '')
                      }
                    }}
                  />
                  {customerSel === '__new__' ? (
                    <>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="sm:col-span-1">
                        <Label className="text-xs text-muted-foreground">Name *</Label>
                        <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
                      </div>
                      <div className="sm:col-span-1">
                        <Label className="text-xs text-muted-foreground">Email</Label>
                        <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
                      </div>
                      <div className="sm:col-span-1">
                        <Label className="text-xs text-muted-foreground">Phone</Label>
                        <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+91 …" />
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium text-foreground">Billing & shipping address are the same</p>
                          <p className="text-[11px] text-muted-foreground">Ship to the billing address</p>
                        </div>
                        <Switch
                          checked={sameAsBilling}
                          onCheckedChange={(on) => {
                            if (on) {
                              const base = hasAddress(billingAddr) ? billingAddr : shippingAddr
                              setBillingAddr(base)
                              setShippingAddr(base)
                            }
                            setSameAsBilling(on)
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <AddressFields title="Billing Address" addr={billingAddr} onChange={setBillingAddr} fallbackName={customerName} />
                        {sameAsBilling ? (
                          <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                            Shipping address will match the billing address. Toggle the switch to enter a different one.
                          </div>
                        ) : (
                          <AddressFields title="Shipping Address" addr={shippingAddr} onChange={setShippingAddr} fallbackName={customerName} />
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line Items</Label>
                  <Button variant="outline" size="sm" onClick={() => setLineItems((prev) => [...prev, emptyLine()])}>
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </div>
                {!editing ? (
                  <div className="mb-3">
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Label className="text-xs text-muted-foreground">Scan barcode / SKU</Label>
                        <Input
                          value={barcodeInput}
                          onChange={(e) => setBarcodeInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeScan() } }}
                          placeholder="Scan or type a barcode / SKU, then press Enter"
                          autoComplete="off"
                        />
                      </div>
                      <Button variant="outline" size="sm" className="h-9" onClick={handleBarcodeScan} disabled={!barcodeInput.trim()}>
                        <ScanBarcode className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                    {scanFeedback ? (
                      <p className={`mt-1.5 text-[11px] ${scanFeedback.ok ? 'text-success-700' : 'text-destructive'}`}>{scanFeedback.text}</p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">Re-scanning an item increases its quantity.</p>
                    )}
                  </div>
                ) : null}
                  {editing ? (
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      Existing line items are not stored in the ERP. Add items below to change the total, or leave them blank to keep the current value.
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {lineItems.map((li) => (
                      <div key={li.key} className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Label className="text-xs text-muted-foreground">Product</Label>
                          <SearchableSelect
                            placeholder="Select product"
                            searchPlaceholder="Search products..."
                            options={products.map((p) => ({ value: p.id, label: p.name, keywords: p.sku, subtitle: p.sku }))}
                            value={li.productId}
                            onValueChange={(v) => selectProduct(li.key, v)}
                          />
                        </div>
                        <div className="w-20">
                          <Label className="text-xs text-muted-foreground">Qty</Label>
                          <Input
                            type="number"
                            min="1"
                            value={li.qty}
                            onChange={(e) => updateLineItem(li.key, { qty: Math.max(1, Number(e.target.value)) })}
                          />
                        </div>
                        <div className="w-28">
                          <Label className="text-xs text-muted-foreground">Price (?)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={li.price}
                            onChange={(e) => updateLineItem(li.key, { price: Number(e.target.value) })}
                          />
                        </div>
                        <div className="w-28 pb-0.5 text-right text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency((Number.isFinite(li.price) ? li.price : 0) * (Number.isFinite(li.qty) ? li.qty : 0))}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="mb-0.5 text-muted-foreground hover:text-red-600"
                          disabled={lineItems.length === 1}
                          onClick={() => setLineItems((prev) => prev.filter((x) => x.key !== li.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{editing && totalValue === 0 ? 'Order value (unchanged)' : 'Total order value'}</span>
                    <span className="font-bold tabular-nums text-foreground">
                      {formatCurrency(totalValue > 0 ? totalValue : (editing?.value ?? 0))}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Order Date</Label>
                    <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Payment</Label>
                    <Select
                      options={[
                        { value: 'paid', label: 'Paid' },
                        { value: 'pending', label: 'Pending' },
                      ]}
                      value={payment}
                      onValueChange={setPayment}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Fulfillment</Label>
                    <Select
                      options={[
                        { value: 'unfulfilled', label: 'Unfulfilled' },
                        { value: 'processing', label: 'Processing' },
                        { value: 'partial', label: 'Partial' },
                        { value: 'fulfilled', label: 'Fulfilled' },
                      ]}
                      value={fulfillment}
                      onValueChange={setFulfillment}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Order Status</Label>
                    <Select
                      options={[
                        { value: 'confirmed', label: 'Confirmed' },
                        { value: 'processing', label: 'Processing' },
                        { value: 'fulfilled', label: 'Fulfilled' },
                        { value: 'imported', label: 'Imported' },
                        { value: 'cancelled', label: 'Cancelled' },
                        { value: 'returned', label: 'Returned' },
                        { value: 'refunded', label: 'Refunded' },
                      ]}
                      value={orderStatus}
                      onValueChange={setOrderStatus}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Note</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the order" />
                </div>

                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">Sync to Shopify</p>
                    <p className="text-[11px] text-muted-foreground">
                      {editing
                        ? 'Update the note, email and shipping address on the existing Shopify order'
                        : 'Create the order on Shopify with the selected payment status'}
                    </p>
                  </div>
                  <Switch checked={syncToShopify} onCheckedChange={setSyncToShopify} />
                </div>

                {formError ? (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{formError}</span>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
                <Button onClick={createOrder} disabled={saving}>
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" /> {editing ? 'Saving...' : syncToShopify ? 'Creating & Syncing...' : 'Creating...'}
                    </>
                  ) : editing ? (
                    syncToShopify ? (
                      'Save & Sync to Shopify'
                    ) : (
                      'Save Changes'
                    )
                  ) : syncToShopify ? (
                    'Create & Sync to Shopify'
                  ) : (
                    'Create Order'
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={viewOrder !== null} onOpenChange={(open) => { if (!open) setViewOrder(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Order {viewOrder?.shopifyId ?? ''}</DialogTitle>
            <DialogDescription>
              {viewOrder ? `${viewOrder.internalId} · placed on ${formatDateTime(viewOrder.date)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {viewOrder ? (
            <div className="space-y-2 text-sm">
              <DetailRow label="Customer" value={viewOrder.customer} />
              {(() => {
                const cust = customers.find((c) => c.name === viewOrder.customer)
                  ?? customers.find((c) => viewOrder.shippingAddress?.phone && c.phone === viewOrder.shippingAddress.phone)
                return cust?.email ? <DetailRow label="Email" value={cust.email} /> : null
              })()}
              {(() => {
                const a = (viewOrder.shippingAddress && (viewOrder.shippingAddress.address1 || viewOrder.shippingAddress.city)) ? viewOrder.shippingAddress : viewOrder.billingAddress
                if (!a) return null
                return (
                  <>
                    {a.phone ? <DetailRow label="Phone" value={a.phone} /> : null}
                    {a.address1 ? <DetailRow label="Address" value={[a.address1, a.address2].filter(Boolean).join(', ')} /> : null}
                    {[a.city, a.province, a.zip].some(Boolean) ? <DetailRow label="City" value={[a.city, a.province, a.zip].filter(Boolean).join(', ')} /> : null}
                    {a.country ? <DetailRow label="Country" value={a.country} /> : null}
                  </>
                )
              })()}
              <DetailRow label="Order Value" value={formatCurrency(viewOrder.value)} />
              {viewOrder.currency && viewOrder.currency.toUpperCase() !== 'INR' ? (
                <DetailRow label="Currency" value={viewOrder.currency} />
              ) : null}
              {viewOrder.discount && viewOrder.discount > 0 ? (
                <DetailRow label="Discount" value={formatCurrency(viewOrder.discount)} />
              ) : null}
              <DetailRow label="Items" value={`${viewOrder.items} item(s)`} />
              {viewOrder.lineItems && viewOrder.lineItems.length > 0 ? (
                <DetailRow
                  label="Items Subtotal"
                  value={formatCurrency(viewOrder.lineItems.reduce((sum, li) => sum + (li.price ?? 0) * (li.quantity ?? 0), 0))}
                />
              ) : null}
              <DetailRow label="Payment" value={getPaymentMeta(viewOrder.payment).label} />
              <DetailRow label="Fulfillment" value={getFulfillmentMeta(viewOrder.fulfillment).label} />
              <DetailRow label="Invoice" value={viewOrder.invoice ?? 'Not raised'} />
              <DetailRow label="Status" value={statusMeta[viewOrder.status]?.label ?? viewOrder.status} />
              <DetailRow label="Order Date" value={formatDate(viewOrder.date)} />
              {viewOrder.tags ? <DetailRow label="Tags" value={viewOrder.tags.split(',').join(', ')} /> : null}
              {viewOrder.billingAddress && (viewOrder.billingAddress.name || viewOrder.billingAddress.address1) ? (
                <div className="border-b border-border/60 py-2">
                  <span className="text-muted-foreground">Billing Address</span>
                  <div className="mt-1 space-y-0.5 text-right text-sm">
                    {viewOrder.billingAddress.name ? <p className="font-medium text-foreground">{viewOrder.billingAddress.name}</p> : null}
                    {viewOrder.billingAddress.phone ? <p className="text-muted-foreground">{viewOrder.billingAddress.phone}</p> : null}
                    {viewOrder.billingAddress.address1 ? <p className="text-foreground">{viewOrder.billingAddress.address1}{viewOrder.billingAddress.address2 ? `, ${viewOrder.billingAddress.address2}` : ''}</p> : null}
                    {[viewOrder.billingAddress.city, viewOrder.billingAddress.province, viewOrder.billingAddress.zip].filter(Boolean).length > 0 ? (
                      <p className="text-foreground">{[viewOrder.billingAddress.city, viewOrder.billingAddress.province, viewOrder.billingAddress.zip].filter(Boolean).join(', ')}</p>
                    ) : null}
                    {viewOrder.billingAddress.country ? <p className="text-muted-foreground">{viewOrder.billingAddress.country}</p> : null}
                  </div>
                </div>
              ) : null}
              {viewOrder.shippingAddress && (viewOrder.shippingAddress.name || viewOrder.shippingAddress.address1) ? (
                <div className="border-b border-border/60 py-2">
                  <span className="text-muted-foreground">Shipping Address</span>
                  <div className="mt-1 space-y-0.5 text-right text-sm">
                    {viewOrder.shippingAddress.name ? <p className="font-medium text-foreground">{viewOrder.shippingAddress.name}</p> : null}
                    {viewOrder.shippingAddress.phone ? <p className="text-muted-foreground">{viewOrder.shippingAddress.phone}</p> : null}
                    {viewOrder.shippingAddress.address1 ? <p className="text-foreground">{viewOrder.shippingAddress.address1}{viewOrder.shippingAddress.address2 ? `, ${viewOrder.shippingAddress.address2}` : ''}</p> : null}
                    {[viewOrder.shippingAddress.city, viewOrder.shippingAddress.province, viewOrder.shippingAddress.zip].filter(Boolean).length > 0 ? (
                      <p className="text-foreground">{[viewOrder.shippingAddress.city, viewOrder.shippingAddress.province, viewOrder.shippingAddress.zip].filter(Boolean).join(', ')}</p>
                    ) : null}
                    {viewOrder.shippingAddress.country ? <p className="text-muted-foreground">{viewOrder.shippingAddress.country}</p> : null}
                  </div>
                </div>
              ) : null}
              {viewOrder.lineItems && viewOrder.lineItems.length > 0 ? (
                <div className="border-b border-border/60 py-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-muted-foreground">Line Items</span>
                    <span className="text-[11px] text-muted-foreground">{viewOrder.lineItems.length} product(s)</span>
                  </div>
                  <div className="space-y-1">
                    {viewOrder.lineItems.map((li, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-foreground">{li.title}</span>
                          {li.sku ? <span className="ml-1.5 font-mono text-muted-foreground">{li.sku}</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {li.quantity} × {formatCurrency(li.price)}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium text-foreground">
                          {formatCurrency((li.price ?? 0) * li.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
            <Button
              disabled={Boolean(viewOrder?.invoice) || invoiceSavingId === viewOrder?.id}
              onClick={() => viewOrder && createInvoiceFor(viewOrder)}
            >
              {invoiceSavingId === viewOrder?.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {viewOrder?.invoice ? 'Invoice Raised' : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function AddressFields({
  title,
  addr,
  onChange,
  fallbackName,
}: {
  title: string
  addr: OrderAddress
  onChange: (a: OrderAddress) => void
  fallbackName: string
}) {
  const set = (patch: Partial<OrderAddress>) => onChange({ ...addr, ...patch })
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div>
        <Label className="text-xs text-muted-foreground">Name</Label>
        <Input value={addr.name} onChange={(e) => set({ name: e.target.value })} placeholder={fallbackName || 'Recipient name'} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Address</Label>
        <Input value={addr.address1} onChange={(e) => set({ address1: e.target.value })} placeholder="Street address, P.O. box" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs text-muted-foreground">City</Label>
          <Input value={addr.city} onChange={(e) => set({ city: e.target.value })} placeholder="City" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">State</Label>
          <Input value={addr.province} onChange={(e) => set({ province: e.target.value })} placeholder="State" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">PIN / Zip</Label>
          <Input value={addr.zip} onChange={(e) => set({ zip: e.target.value })} placeholder="PIN code" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Phone</Label>
          <Input value={addr.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Phone" />
        </div>
      </div>
    </div>
  )
}
