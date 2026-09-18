import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@/lib/table'
import {
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Printer,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dbApi } from '@/lib/api'
import type { AppSettings, Quotation } from '@/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { escapeHtml, numberToIndianWords } from '@/lib/utils'

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'muted' }> = {
  draft: { label: 'Draft', variant: 'info' },
  sent: { label: 'Sent', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  converted: { label: 'Converted', variant: 'success' },
  expired: { label: 'Expired', variant: 'muted' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
}

interface ItemForm {
  product: string
  sku: string
  qty: string
  weight: string
  silverRate: string
  makingCharge: string
}

const emptyItem: ItemForm = { product: '', sku: '', qty: '1', weight: '', silverRate: '', makingCharge: '' }

export default function QuotationsPage() {
  const [quotes, setQuotes] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ customer: '', phone: '', email: '', city: '', notes: '', gst: '3', discount: '0', validUntil: '' })
  const [items, setItems] = useState<ItemForm[]>([{ ...emptyItem }])
  const [viewQuote, setViewQuote] = useState<Quotation | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    dbApi.getSettings().then((s) => setSettings(s ?? null)).catch(() => {})
  }, [])

  const printQuotation = (q: Quotation) => {
    const w = window.open('', '_blank', 'width=900,height=760')
    if (!w) return
    w.opener = null
    const gstRate = Number(q.gst) || 0
    const totalTax = Number(q.gstAmount) || 0
    const items = q.items ?? []
    const totalWeight = items.reduce((a, i) => a + (i.weight ?? 0), 0)
    const totalQty = items.reduce((a, i) => a + (i.qty ?? 0), 0)
    const itemRows = items
      .map(
        (i, idx) => `<tr style="${idx % 2 === 0 ? 'background:#f8f9fa;' : ''}">
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;">${escapeHtml(i.product)}<br/><span style="color:#6b728b;font-size:9px;">${escapeHtml(i.sku)}</span></td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${i.qty}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${(i.weight ?? 0).toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${(i.silverRate ?? 0).toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${(i.makingCharge ?? 0).toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;font-weight:600;">₹${(i.amount ?? 0).toFixed(2)}</td>
        </tr>`,
      )
      .join('')
    const validity = q.validUntil ? formatDate(q.validUntil) : '15 days from quotation date'
    w.document.write(`<!doctype html><html><head><title>Quotation ${escapeHtml(q.number)}</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Inter',Arial,sans-serif;color:#1f2937;margin:0;padding:24px;background:#fff;}
      .header-banner{background:#1a1a2e;color:#fff;padding:16px 20px;border-radius:6px;margin-bottom:16px;}
      .header-banner h1{font-size:20px;font-weight:700;margin-bottom:4px;letter-spacing:0.5px;}
      .header-banner .sub{color:#a0aec0;font-size:9px;margin-bottom:2px;}
      .badge{display:inline-block;background:#c8a951;color:#1a1a2e;padding:5px 16px;font-size:10px;font-weight:700;letter-spacing:1.5px;border-radius:3px;}
      .info-row{display:flex;justify-content:space-between;margin-bottom:16px;}
      .info-box{background:#f8f9fa;border-radius:4px;padding:12px 14px;flex:1;margin-right:8px;}
      .info-box:last-child{margin-right:0;}
      .info-box .label{font-size:8px;font-weight:600;color:#6b728b;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}
      .info-box .value{font-size:12px;font-weight:600;color:#1f2937;}
      .billto-row{display:flex;gap:12px;margin-bottom:16px;}
      .billto-box{background:#f8f9fa;border-radius:4px;padding:12px 14px;flex:1;}
      .billto-box .label{font-size:8px;font-weight:600;color:#6b728b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}
      .billto-box .name{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:3px;}
      .billto-box .detail{font-size:10px;color:#6b728b;line-height:1.5;}
      table.items{width:100%;border-collapse:collapse;margin-bottom:16px;}
      table.items thead th{background:#1a1a2e;color:#fff;padding:8px 10px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:left;}
      table.items thead th:last-child{text-align:right;}
      table.items tbody td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      .totals-box{float:right;width:260px;background:#f8f9fa;border-radius:4px;padding:14px;margin-bottom:16px;}
      .totals-box .row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:#374151;}
      .totals-box .grand{display:flex;justify-content:space-between;padding:6px 0 0;font-size:14px;font-weight:700;color:#1a1a2e;border-top:2px solid #c8a951;margin-top:6px;padding-top:8px;}
      .amount-words{background:#fef3c7;border-radius:4px;padding:10px 14px;font-size:10px;color:#92400e;margin:16px 0;clear:both;}
      .amount-words b{color:#78350f;}
      .terms{border-top:1px solid #e5e7eb;padding-top:12px;margin-top:16px;font-size:9px;color:#6b728b;line-height:1.6;max-width:65%;}
      .signatures{display:flex;justify-content:space-between;margin-top:20px;}
      .sig-block{text-align:center;width:140px;}
      .sig-line{border-top:1px solid #d1d5db;margin-top:40px;padding-top:4px;font-size:9px;color:#6b728b;}
      .gen-footer{text-align:center;font-size:8px;color:#9ca3af;margin-top:16px;padding-top:8px;border-top:1px solid #f3f4f6;}
      @media print{body{padding:12mm;font-size:10px;}.header-banner{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table.items thead th{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head><body>
      <div class="header-banner">
        <h1>${escapeHtml(settings?.businessName || 'OPAL LINE JEWELS LLP')}</h1>
        <div class="sub">92.5 Sterling Silver Jewellery${settings?.gstin ? ` · GSTIN: ${escapeHtml(settings.gstin)}` : ''}</div>
        ${settings?.address ? `<div class="sub">${escapeHtml(settings.address)}</div>` : ''}
        ${settings?.phone || settings?.email ? `<div class="sub">${[settings.phone, settings.email].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="info-row" style="flex:1;margin-right:16px;">
          <div class="info-box" style="margin-right:8px;">
            <div class="label">Quotation No</div>
            <div class="value">${escapeHtml(q.number)}</div>
          </div>
          <div class="info-box" style="margin-right:8px;">
            <div class="label">Date</div>
            <div class="value">${formatDate(q.date)}</div>
          </div>
          <div class="info-box">
            <div class="label">Valid Until</div>
            <div class="value">${escapeHtml(validity)}</div>
          </div>
        </div>
        <div class="badge">QUOTATION</div>
      </div>
      <div class="billto-row">
        <div class="billto-box">
          <div class="label">Prepared For</div>
          <div class="name">${escapeHtml(q.customer ?? '—')}</div>
          <div class="detail">${escapeHtml(q.customerPhone ?? '')}${q.customerPhone && q.customerCity ? '<br/>' : ''}${escapeHtml(q.customerCity ?? '')}</div>
        </div>
        <div class="billto-box">
          <div class="label">Notes</div>
          <div class="detail">${escapeHtml(q.notes ?? '—')}</div>
        </div>
      </div>
      <table class="items">
        <thead><tr>
          <th>Product</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Weight (g)</th><th style="text-align:right;">Rate (₹/g)</th><th style="text-align:right;">Making (₹)</th><th style="text-align:right;">Amount (₹)</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr style="background:#f8f9fa;font-weight:600;">
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;font-size:10px;">Total: ${totalQty} item(s)</td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:10px;">${totalQty}</td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:10px;">${totalWeight.toFixed(2)} g</td>
          <td colspan="2"></td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:11px;">₹${Number(q.subtotal).toFixed(2)}</td>
        </tr></tfoot>
      </table>
      <div class="totals-box">
        <div class="row"><span>Taxable Value</span><span>₹${Number(q.subtotal).toFixed(2)}</span></div>
        <div class="row"><span>GST @ ${gstRate}%</span><span>₹${totalTax.toFixed(2)}</span></div>
        ${Number(q.discount) > 0 ? `<div class="row" style="color:#dc2626;"><span>Discount</span><span>- ₹${Number(q.discount).toFixed(2)}</span></div>` : ''}
        <div class="grand"><span>QUOTED TOTAL</span><span>₹${Number(q.grandTotal).toFixed(2)}</span></div>
      </div>
      <div class="amount-words"><b>Amount in Words:</b> ${numberToIndianWords(Number(q.grandTotal))} Rupees Only</div>
      <div class="terms">
        <b>Terms &amp; Conditions:</b> Prices are based on the prevailing silver rate on the quotation date and are valid until ${escapeHtml(validity)}. Actual invoice value may vary with the silver rate on the date of billing. Making charges as stated; GST extra as applicable. This quotation is not a tax invoice.
      </div>
      <div class="signatures">
        <div class="sig-block"><div class="sig-line">Customer Acceptance</div></div>
        <div class="sig-block"><div class="sig-line">For ${escapeHtml(settings?.businessName || 'OPAL LINE JEWELS LLP')}<br/><span style="font-size:8px;">Authorised Signatory</span></div></div>
      </div>
      <div class="gen-footer">Generated by ${escapeHtml(settings?.businessName || 'Opal Line')} ERP · opalline.in</div>
      <script>window.onload=function(){window.focus();window.print();}</script>
    </body></html>`)
    w.document.close()
  }

  const load = useCallback(() => {
    setLoading(true)
    dbApi.getQuotations().then((d) => {
      setQuotes(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return quotes.filter((r) => {
      const matchQ = !q || r.number.toLowerCase().includes(q) || (r.customer ?? '').toLowerCase().includes(q)
      const matchStatus = !statusFilter || r.status === statusFilter
      return matchQ && matchStatus
    })
  }, [quotes, query, statusFilter])

  const itemAmount = (it: ItemForm) => {
    const weight = parseFloat(it.weight) || 0
    const rate = parseFloat(it.silverRate) || 0
    const making = parseFloat(it.makingCharge) || 0
    if (weight > 0 && rate > 0) return Math.round((weight * rate + making) * 100) / 100
    return 0
  }

  const itemsTotal = items.reduce((a, it) => a + itemAmount(it), 0)
  const gstRate = parseFloat(form.gst) || 0
  const discount = parseFloat(form.discount) || 0
  const gstAmount = Math.round(((itemsTotal * gstRate) / 100) * 100) / 100
  const grandTotal = Math.round((itemsTotal + gstAmount - discount) * 100) / 100

  const openDialog = () => {
    setForm({ customer: '', phone: '', email: '', city: '', notes: '', gst: '3', discount: '0', validUntil: '' })
    setItems([{ ...emptyItem }])
    setError('')
    setDialogOpen(true)
  }

  const setItem = (idx: number, patch: Partial<ItemForm>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const submit = async () => {
    const validItems = items.filter((it) => it.product.trim() || it.sku.trim())
    if (!form.customer.trim()) { setError('Customer name is required'); return }
    if (validItems.length === 0) { setError('Add at least one product line'); return }
    setSaving(true)
    setError('')
    try {
      await dbApi.createQuotation({
        customer: form.customer.trim(),
        customerPhone: form.phone.trim() || null,
        customerEmail: form.email.trim() || null,
        customerCity: form.city.trim() || null,
        notes: form.notes.trim() || null,
        validUntil: form.validUntil || null,
        gst: gstRate,
        discount,
        items: validItems.map((it) => ({
          product: it.product.trim(),
          sku: it.sku.trim(),
          qty: Math.max(1, parseInt(it.qty, 10) || 1),
          weight: parseFloat(it.weight) || 0,
          silverRate: parseFloat(it.silverRate) || 0,
          makingCharge: parseFloat(it.makingCharge) || 0,
        })),
      })
      setDialogOpen(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quotation')
    } finally {
      setSaving(false)
    }
  }

  const convert = async (q: Quotation) => {
    if (!confirm(`Convert ${q.number} into a tax invoice? Stock will be deducted and an invoice number generated.`)) return
    setConvertingId(q.id)
    setMessage(null)
    try {
      const r = await dbApi.convertQuotation(q.id)
      setMessage({ ok: true, text: `${q.number} converted to invoice ${r.invoiceNumber}` })
      load()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Conversion failed' })
    } finally {
      setConvertingId(null)
    }
  }

  const removeQuote = async (id: string) => {
    if (!confirm('Delete this quotation?')) return
    try {
      await dbApi.deleteQuotation(id)
      setQuotes((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const columns = useMemo<ColumnDef<Quotation>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Quotation',
        meta: { headerClassName: 'min-w-[150px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <p className="font-mono font-medium text-foreground">{row.original.number}</p>
              <p className="text-[11px] text-muted-foreground">{formatDate(row.original.date)}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'customer',
        header: 'Customer',
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.customer ?? '—'}</span>,
      },
      {
        id: 'phone',
        header: 'Phone',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.customerPhone ?? '—'}</span>,
      },
      {
        accessorKey: 'grandTotal',
        header: 'Total',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.grandTotal)}</span>,
      },
      {
        accessorKey: 'validUntil',
        header: 'Valid Until',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.validUntil ? formatDate(row.original.validUntil) : '—'}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusBadge[row.original.status] ?? { label: row.original.status, variant: 'muted' as const }
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
                  <Button variant="ghost" size="icon-sm" onClick={() => printQuotation(row.original)}>
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Print / PDF</TooltipContent>
              </Tooltip>
              {row.original.status !== 'converted' && row.original.status !== 'cancelled' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={convertingId === row.original.id}
                      onClick={() => convert(row.original)}
                    >
                      {convertingId === row.original.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <CheckCircle2 className="h-3.5 w-3.5 text-success-600" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Convert to invoice</TooltipContent>
                </Tooltip>
              )}
              {row.original.convertedInvoice && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex h-8 w-8 items-center justify-center text-[10px] font-semibold text-success-700">
                      {row.original.convertedInvoice.slice(-4)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Invoice {row.original.convertedInvoice}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeQuote(row.original.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete quotation</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [convertingId],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Quotations"
        subtitle="Pre-sale estimates for walk-in and enquiry customers — convert approved quotes into tax invoices in one click."
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> New Quotation
          </Button>
        }
      />

      {message && (
        <Card className={`border ${message.ok ? 'border-success-200 bg-success-50' : 'border-red-200 bg-red-50'}`}>
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            {message.ok ? <CheckCircle2 className="h-4 w-4 text-success-600" /> : <span className="text-red-600">⚠</span>}
            <span className={message.ok ? 'text-success-800' : 'text-red-800'}>{message.text}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard label="Total Quotations" value={String(quotes.length)} sub="All time" />
        <MiniCard label="Open" value={String(quotes.filter((q) => q.status === 'draft' || q.status === 'sent').length)} sub="Awaiting decision" />
        <MiniCard label="Converted" value={String(quotes.filter((q) => q.status === 'converted').length)} sub="Became invoices" />
        <MiniCard label="Quoted Value" value={formatCurrency(quotes.filter((q) => q.status !== 'converted' && q.status !== 'cancelled').reduce((a, q) => a + q.grandTotal, 0))} sub="Open pipeline" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search quote number, customer..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'draft', label: 'Draft' },
                { value: 'sent', label: 'Sent' },
                { value: 'approved', label: 'Approved' },
                { value: 'converted', label: 'Converted' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-[140px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {quotes.length} quotations
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No quotations found"
            onRowClick={(q) => setViewQuote(q)}
            onRowDoubleClick={(q) => convert(q)}
          />
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Quotation</DialogTitle>
            <DialogDescription>Create a pre-sale estimate. Nothing is billed until you convert it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Customer name *">
                <Input value={form.customer} onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))} placeholder="Walk-in customer" />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+91..." />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </Field>
            </div>

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Line items</Label>
                <Button variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, { ...emptyItem }])}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2.5 sm:grid-cols-6">
                  <div className="col-span-2 sm:col-span-2">
                    <Label className="text-[10px] text-muted-foreground">Product</Label>
                    <Input className="h-8 text-xs" value={it.product} onChange={(e) => setItem(idx, { product: e.target.value })} placeholder="Item name" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">SKU</Label>
                    <Input className="h-8 text-xs" value={it.sku} onChange={(e) => setItem(idx, { sku: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Qty</Label>
                    <Input className="h-8 text-xs" type="number" min="1" value={it.qty} onChange={(e) => setItem(idx, { qty: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Weight (g)</Label>
                    <Input className="h-8 text-xs" type="number" value={it.weight} onChange={(e) => setItem(idx, { weight: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Making ₹</Label>
                    <Input className="h-8 text-xs" type="number" value={it.makingCharge} onChange={(e) => setItem(idx, { makingCharge: e.target.value })} />
                  </div>
                  <div className="col-span-2 flex items-center justify-between sm:col-span-6">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Silver rate ₹/g</span>
                      <Input className="h-7 w-24 text-xs" type="number" value={it.silverRate} onChange={(e) => setItem(idx, { silverRate: e.target.value })} />
                      <span className="font-semibold text-foreground">Line: {formatCurrency(itemAmount(it))}</span>
                    </div>
                    {items.length > 1 && (
                      <Button variant="ghost" size="icon-sm" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
              <Field label="GST %">
                <Input type="number" value={form.gst} onChange={(e) => setForm((f) => ({ ...f, gst: e.target.value }))} />
              </Field>
              <Field label="Discount ₹">
                <Input type="number" value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
              </Field>
              <Field label="Valid until">
                <Input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
              </Field>
              <div className="rounded-lg bg-muted/50 p-2 text-right">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Grand total</p>
                <p className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(grandTotal)}</p>
                <p className="text-[10px] text-muted-foreground">{formatCurrency(itemsTotal)} + {formatCurrency(gstAmount)} GST − {formatCurrency(discount)}</p>
              </div>
            </div>

            <Field label="Notes">
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Design details, delivery promise..." />
            </Field>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={viewQuote !== null} onOpenChange={(open) => { if (!open) setViewQuote(null) }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quotation {viewQuote?.number}</DialogTitle>
            <DialogDescription>{viewQuote ? formatDate(viewQuote.date) : ''}</DialogDescription>
          </DialogHeader>
          {viewQuote && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{viewQuote.customer ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{viewQuote.customerPhone ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant={statusBadge[viewQuote.status]?.variant ?? 'muted'} dot>{statusBadge[viewQuote.status]?.label ?? viewQuote.status}</Badge></div>
              {viewQuote.validUntil && <div className="flex justify-between"><span className="text-muted-foreground">Valid until</span><span>{formatDate(viewQuote.validUntil)}</span></div>}
              {viewQuote.convertedInvoice && (
                <div className="flex justify-between"><span className="text-muted-foreground">Converted to</span><span className="font-mono font-medium text-success-700">{viewQuote.convertedInvoice}</span></div>
              )}
              <div className="border-t pt-2">
                <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Items</p>
                <div className="space-y-1.5">
                  {(viewQuote.items ?? []).map((it, i) => (
                    <div key={it.id ?? i} className="flex justify-between text-xs">
                      <span>{it.product || it.sku} × {it.qty}{it.weight ? ` · ${it.weight}g` : ''}</span>
                      <span className="tabular-nums">{formatCurrency(it.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1 border-t pt-2">
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(viewQuote.subtotal)}</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">GST ({viewQuote.gst}%)</span><span>{formatCurrency(viewQuote.gstAmount)}</span></div>
                {viewQuote.discount > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Discount</span><span>−{formatCurrency(viewQuote.discount)}</span></div>}
                <div className="flex justify-between border-t pt-1.5 font-semibold"><span>Grand total</span><span>{formatCurrency(viewQuote.grandTotal)}</span></div>
              </div>
              {viewQuote.notes && <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{viewQuote.notes}</p>}
              {viewQuote.status !== 'converted' && viewQuote.status !== 'cancelled' && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" size="sm" onClick={() => printQuotation(viewQuote)}>
                    <Printer className="h-4 w-4" /> Print / PDF
                  </Button>
                  <Button className="flex-1" size="sm" disabled={convertingId === viewQuote.id} onClick={() => { const q = viewQuote; setViewQuote(null); convert(q) }}>
                    <Wallet className="h-4 w-4" /> Convert to Invoice
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function MiniCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </Card>
  )
}
