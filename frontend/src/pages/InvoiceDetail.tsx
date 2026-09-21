import { confirmDialog, toast } from '@/components/ui/confirm'
﻿import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  Printer,
  ShieldCheck,
  ShoppingBag,
  Undo2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { escapeHtml, numberToIndianWords } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dbApi } from '@/lib/api'
import type { AppSettings, Invoice } from '@/types'
import { formatCurrency, formatDateTime } from '@/lib/format'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refunding, setRefunding] = useState(false)
  const [waSending, setWaSending] = useState(false)
  // Return-dialog state must live above the early returns (Rules of Hooks)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnQty, setReturnQty] = useState<Record<string, number>>({})
  const [restock, setRestock] = useState(true)
  const [returning, setReturning] = useState(false)

  useEffect(() => {
    setLoading(true)
    dbApi.getInvoiceById(id ?? '').then((inv) => {
      setInvoice(inv ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
    dbApi.getSettings().then((s) => setSettings(s ?? null)).catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1300px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Skeleton className="h-72 rounded-lg lg:col-span-2" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!invoice) {
    return <div className="px-6 py-6 text-sm text-muted-foreground">Invoice not found.</div>
  }

  const printInvoice = () => {
    const w = window.open('', '_blank', 'width=900,height=760')
    if (!w) return
    w.opener = null
    const gstRate = Number(invoice.gst) || 0
    const taxable = Math.max(0, Number(invoice.subtotal) - Number(invoice.discount))
    const totalTax = Number(invoice.gstAmount) || 0
    const halfTax = Math.round((totalTax / 2) * 100) / 100
    const hsnCodes = [...new Set(invoice.items.map((i) => i.hsn).filter(Boolean))] as string[]
    const hsnDisplay = hsnCodes.length > 0 ? hsnCodes.join(', ') : '7113'
    const totalWeight = invoice.items.reduce((a, i) => a + i.weight, 0)
    const totalQty = invoice.items.reduce((a, i) => a + i.qty, 0)
    const itemRows = invoice.items
      .map(
        (i, idx) => `<tr style="${idx % 2 === 0 ? 'background:#f8f9fa;' : ''}">
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;">${escapeHtml(i.product)}<br/><span style="color:#6b728b;font-size:9px;">${escapeHtml(i.sku)}</span></td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:center;">${escapeHtml(i.hsn ?? hsnDisplay)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${i.qty}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${i.weight.toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${i.silverRate.toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${i.makingCharge.toFixed(2)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${i.tax}%</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;font-weight:600;">₹${i.amount.toFixed(2)}</td>
        </tr>`,
      )
      .join('')
    w.document.write(`<!doctype html><html><head><title>Tax Invoice ${escapeHtml(invoice.number)}</title><style>
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
      .info-box .detail{font-size:10px;color:#6b728b;margin-top:2px;}
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
      .totals-box .divider{border-top:1px solid #d1d5db;margin:6px 0;}
      .totals-box .grand{display:flex;justify-content:space-between;padding:6px 0 0;font-size:14px;font-weight:700;color:#1a1a2e;border-top:2px solid #c8a951;margin-top:6px;padding-top:8px;}
      .amount-words{background:#fef3c7;border-radius:4px;padding:10px 14px;font-size:10px;color:#92400e;margin:16px 0;clear:both;}
      .amount-words b{color:#78350f;}
      .footer{border-top:1px solid #e5e7eb;padding-top:12px;margin-top:16px;}
      .declaration{font-size:9px;color:#6b728b;line-height:1.6;margin-bottom:16px;max-width:65%;}
      .signatures{display:flex;justify-content:space-between;margin-top:20px;}
      .sig-block{text-align:center;width:140px;}
      .sig-line{border-top:1px solid #d1d5db;margin-top:40px;padding-top:4px;font-size:9px;color:#6b728b;}
      .gen-footer{text-align:center;font-size:8px;color:#9ca3af;margin-top:16px;padding-top:8px;border-top:1px solid #f3f4f6;}
      @media print{body{padding:12mm;font-size:10px;}.header-banner{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table.items thead th{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head><body>
      <div class="header-banner">
        <h1>${escapeHtml(settings?.businessName || invoice.businessName || 'OPAL LINE JEWELS LLP')}</h1>
        <div class="sub">92.5 Sterling Silver Jewellery${settings?.gstin ? ` · GSTIN: ${escapeHtml(settings.gstin)}` : ''}</div>
        ${settings?.address ? `<div class="sub">${escapeHtml(settings.address)}</div>` : ''}
        ${settings?.phone || settings?.email ? `<div class="sub">${[settings.phone, settings.email].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        <div class="sub">E-commerce sale via Shopify</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div class="info-row" style="flex:1;margin-right:16px;">
          <div class="info-box" style="margin-right:8px;">
            <div class="label">Invoice No</div>
            <div class="value">${escapeHtml(invoice.number)}</div>
          </div>
          <div class="info-box" style="margin-right:8px;">
            <div class="label">Date</div>
            <div class="value">${formatDateTime(invoice.date)}</div>
          </div>
          <div class="info-box">
            <div class="label">Payment</div>
            <div class="value">${escapeHtml(invoice.paymentMethod)}</div>
            <div class="detail">${escapeHtml(invoice.paymentStatus)}</div>
          </div>
        </div>
        <div class="badge">TAX INVOICE</div>
      </div>
      <div class="billto-row">
        <div class="billto-box">
          <div class="label">Bill To</div>
          <div class="name">${escapeHtml(invoice.customer)}</div>
          <div class="detail">${escapeHtml(invoice.customerEmail) ?? ''}${invoice.customerPhone ? '<br/>' + escapeHtml(invoice.customerPhone) : ''}</div>
          ${invoice.customerAddress || invoice.customerCity || invoice.customerState || invoice.customerPincode ? `<div class="detail" style="margin-top:4px;white-space:pre-line;">${[
            invoice.customerAddress,
            [invoice.customerCity, invoice.customerState, invoice.customerPincode].filter(Boolean).join(', '),
          ].filter(Boolean).join('\n')}</div>` : ''}
        </div>
        <div class="billto-box">
          <div class="label">Order Details</div>
          <div class="value">${escapeHtml(invoice.shopifyOrder ?? '')}</div>
          <div class="detail">Intra-state supply · GST @ ${gstRate}%</div>
        </div>
      </div>
      <table class="items">
        <thead><tr>
          <th>Product</th><th style="text-align:center;">HSN</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Weight (g)</th><th style="text-align:right;">Rate (₹/g)</th><th style="text-align:right;">Making (₹)</th><th style="text-align:right;">GST</th><th style="text-align:right;">Amount (₹)</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr style="background:#f8f9fa;font-weight:600;">
          <td colspan="2" style="padding:8px 10px;border-top:2px solid #1a1a2e;font-size:10px;">Total: ${totalQty} item(s)</td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:10px;">${totalQty}</td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:10px;">${totalWeight.toFixed(2)} g</td>
          <td colspan="3"></td>
          <td style="padding:8px 10px;border-top:2px solid #1a1a2e;text-align:right;font-size:11px;">₹${Number(invoice.subtotal).toFixed(2)}</td>
        </tr></tfoot>
      </table>
      <div class="totals-box">
        <div class="row"><span>Taxable Value</span><span>₹${taxable.toFixed(2)}</span></div>
        <div class="row"><span>CGST @ ${gstRate / 2}%</span><span>₹${halfTax.toFixed(2)}</span></div>
        <div class="row"><span>SGST @ ${gstRate / 2}%</span><span>₹${halfTax.toFixed(2)}</span></div>
        <div class="row"><span>Total GST</span><span>₹${totalTax.toFixed(2)}</span></div>
        ${Number(invoice.discount) > 0 ? `<div class="row" style="color:#dc2626;"><span>Discount</span><span>- ₹${Number(invoice.discount).toFixed(2)}</span></div>` : ''}
        <div class="grand"><span>GRAND TOTAL</span><span>₹${Number(invoice.grandTotal).toFixed(2)}</span></div>
      </div>
      <div class="amount-words"><b>Amount in Words:</b> ${numberToIndianWords(Number(invoice.grandTotal))} Rupees Only</div>
      <div class="footer">
        <div class="declaration"><b>Declaration:</b> We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold will only be exchanged as per store policy. This is a computer-generated invoice.</div>
        <div class="signatures">
          <div class="sig-block"><div class="sig-line">Customer Signature</div></div>
          <div class="sig-block"><div class="sig-line">For ${escapeHtml(invoice.businessName || 'OPAL LINE JEWELS LLP')}<br/><span style="font-size:8px;">Authorised Signatory</span></div></div>
        </div>
      </div>
      <div class="gen-footer">Generated by ${escapeHtml(invoice.businessName || 'Opal Line')} ERP · opalline.in</div>
      <script>window.onload=function(){window.focus();window.print();}</script>
    </body></html>`)
    w.document.close()
  }

  const [emailSending, setEmailSending] = useState(false)

  const emailInvoice = async () => {
    setEmailSending(true)
    try {
      const result = await dbApi.emailInvoice(invoice.id, invoice.customerEmail || undefined)
      if (result.ok) {
        toast.success(`Invoice ${invoice.number} emailed to ${result.to}`)
      } else {
        toast.error(result.error || 'Email send failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Email send failed')
    } finally {
      setEmailSending(false)
    }
  }

  const sendWhatsAppInvoice = async () => {
    setWaSending(true)
    try {
      const result = await dbApi.sendInvoiceWhatsApp(invoice.id)
      if (result.ok) {
        toast.success(`Invoice ${invoice.number} sent to ${result.to} on WhatsApp`)
      } else {
        toast.error(result.error || 'WhatsApp send failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'WhatsApp send failed')
    } finally {
      setWaSending(false)
    }
  }

  const refundInvoice = async () => {
    if (!(await confirmDialog({ title: `Mark invoice ${invoice.number} as refunded? This cannot be undone.` }))) return
    setRefunding(true)
    try {
      await dbApi.update('invoices', invoice.id, { status: 'refunded', paymentStatus: 'refunded' })
      setInvoice({ ...invoice, status: 'refunded', paymentStatus: 'refunded' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setRefunding(false)
    }
  }

  // Returns: choose quantities per line item → credit note + optional restock
  const openReturnDialog = () => {
    const initial: Record<string, number> = {}
    for (const it of invoice.items) if (it.sku) initial[it.sku] = 0
    setReturnQty(initial)
    setRestock(true)
    setReturnOpen(true)
  }

  const submitReturn = async () => {
    const items = Object.entries(returnQty)
      .filter(([, qty]) => qty > 0)
      .map(([sku, qty]) => ({ sku, qty }))
    if (items.length === 0) { toast.error('Enter a quantity greater than 0 for at least one item.'); return }
    setReturning(true)
    try {
      const r = await dbApi.createReturn(invoice.id, { items, restock })
      toast.success(
        `Return processed — credit note ${r.creditNoteNumber}, ₹${r.amount.toLocaleString('en-IN')}${r.restocked ? ', items restocked' : ''}`,
      )
      setReturnOpen(false)
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Return failed')
    } finally {
      setReturning(false)
    }
  }

  const customerInitial = invoice.customer.split(' ').map((n) => n[0]).join('').slice(0, 2)

  return (
    <div className="mx-auto w-full max-w-[1300px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/sales/invoices" className="flex items-center gap-1 hover:text-primary-700">
          <ArrowLeft className="h-3 w-3" /> Sales Invoices
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-foreground">{invoice.number}</span>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300 ring-1 ring-primary-100">
              <FileText className="h-5 w-5" />
            </div>
            <span>Sales Invoice</span>
            <span className="font-mono text-lg font-semibold text-primary-700">{invoice.number}</span>
            {invoice.status === 'refunded' ? (
              <Badge variant="muted" dot>REFUNDED</Badge>
            ) : (
              <Badge variant="success" dot>PAID</Badge>
            )}
          </span>
        }
        subtitle={`${invoice.shopifyOrder ? `Shopify Order ${invoice.shopifyOrder}` : 'Manual / Booking invoice'} · ${formatDateTime(invoice.date)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={printInvoice}><Printer className="h-3.5 w-3.5" /> Print</Button>
            <Button variant="outline" size="sm" onClick={printInvoice}><Download className="h-3.5 w-3.5" /> Save as PDF</Button>
            <Button variant="outline" size="sm" onClick={emailInvoice} disabled={emailSending}><Mail className="h-3.5 w-3.5" /> {emailSending ? 'Sending…' : 'Email'}</Button>
            {invoice.customerPhone ? (
              <Button variant="outline" size="sm" onClick={sendWhatsAppInvoice} disabled={waSending}><MessageCircle className="h-3.5 w-3.5" /> {waSending ? 'Sending…' : 'Send WhatsApp'}</Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={openReturnDialog} disabled={invoice.status === 'refunded' || invoice.status === 'cancelled'}><Undo2 className="h-3.5 w-3.5" /> Return Items</Button>
            <Button variant="soft-danger" size="sm" onClick={refundInvoice} disabled={refunding || invoice.status === 'refunded'}><Undo2 className="h-3.5 w-3.5" /> Refund</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Invoice Items</CardTitle>
                <CardDescription>{invoice.items.length} line items · 92.5% Sterling Silver</CardDescription>
              </div>
              <Badge variant="success">
                <CircleCheck className="h-3 w-3" /> Ecommerce Sale
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Silver Rate</TableHead>
                    <TableHead className="text-right">Making</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-700 dark:bg-primary-50/60 dark:text-primary-300">
                            <FileText className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{item.product}</p>
                            <p className="text-[10.5px] text-muted-foreground">{item.sku}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{item.weight.toFixed(2)} gm</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">₹{item.silverRate.toFixed(2)}/g</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">₹{item.makingCharge}/g</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{item.tax}%</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(item.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end gap-4 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
                <span>{invoice.items.reduce((a, i) => a + i.qty, 0)} items</span>
                <span>{invoice.items.reduce((a, i) => a + i.weight, 0).toFixed(2)} gm</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Billed To</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
                    {customerInitial}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{invoice.customer}</p>
                    <p className="text-xs text-muted-foreground">{invoice.customerEmail}</p>
                    {invoice.customerPhone ? <p className="text-xs text-muted-foreground">{invoice.customerPhone}</p> : null}
                  </div>
                </div>
                {invoice.customerAddress || invoice.customerCity || invoice.customerState || invoice.customerPincode ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {invoice.customerAddress ? <p>{invoice.customerAddress}</p> : null}
                    {[invoice.customerCity, invoice.customerState, invoice.customerPincode].filter(Boolean).length > 0 ? (
                      <p>{[invoice.customerCity, invoice.customerState, invoice.customerPincode].filter(Boolean).join(', ')}</p>
                    ) : null}
                  </div>
                ) : null}
                <Separator className="my-4" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shopify Order</span>
                    <span className="font-mono font-medium text-foreground">{invoice.shopifyOrder || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payment Method</span>
                    <span className="font-medium text-foreground">{invoice.paymentMethod}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice Date</span>
                    <span className="font-medium text-foreground">{formatDateTime(invoice.date)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Amount Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <SummaryRow label="Silver Value" value={formatCurrency(invoice.silverValue)} />
                <SummaryRow label="Making Charge" value={formatCurrency(invoice.makingCharge)} />
                <SummaryRow label="Subtotal" value={formatCurrency(invoice.subtotal)} />
                <SummaryRow label={`GST @ ${invoice.gst}%`} value={formatCurrency(invoice.gstAmount)} />
                <SummaryRow label="Discount" value={`- ${formatCurrency(invoice.discount)}`} />
                <Separator />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-semibold text-foreground">Grand Total</span>
                  <span className="text-xl font-bold text-primary-700">{formatCurrency(invoice.grandTotal)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-success-100 bg-success-50/60 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-success-700 text-white">
                  <CircleCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-success-700">Paid via Razorpay</p>
                  <p className="text-[11px] text-success-700/80">Settled · reconciled with bank</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment ID</span>
                  <span className="font-mono text-xs font-medium text-foreground">{invoice.paymentId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatCurrency(invoice.grandTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gateway</span>
                  <span className="font-medium text-foreground">Razorpay</span>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => window.open('https://dashboard.razorpay.com/app/payments', '_blank', 'noopener')}>
                <ExternalLink className="h-3.5 w-3.5" /> View on Razorpay
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Order Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shopify Order</span>
                <Link to="/sales/orders" className="flex items-center gap-1 font-mono font-medium text-primary-700 hover:underline">
                  {invoice.shopifyOrder || 'No linked order'} <ShoppingBag className="h-3 w-3" />
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fulfillment</span>
                <span className="font-medium text-foreground">{invoice.paymentStatus ?? 'Pending'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST</span>
                <span className="font-medium text-foreground">{invoice.gst}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST Type</span>
                <span className="font-medium text-foreground">Intra-state</span>
              </div>
              <Separator className="my-2" />
              <div className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-700" />
                {invoice.shopifyOrder
                  ? `Invoice generated automatically from Shopify order #${invoice.shopifyOrder.slice(1)}.`
                  : 'Invoice generated from a booking or manual order.'}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return items — {invoice.number}</DialogTitle>
            <DialogDescription>Choose quantities to return. A credit note is generated automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {invoice.items.filter((it) => it.sku).map((it) => (
              <div key={it.sku} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{it.product}</p>
                  <p className="text-[11px] text-muted-foreground">{it.sku} · invoiced qty {it.qty}</p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={it.qty}
                  value={returnQty[it.sku] ?? 0}
                  onChange={(e) => setReturnQty((q) => ({ ...q, [it.sku]: Math.max(0, Math.min(it.qty, Number(e.target.value) || 0)) }))}
                  className="w-20"
                />
              </div>
            ))}
            <label className="flex items-center gap-2 pt-1 text-xs">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
              Restock returned items into inventory
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReturnOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitReturn} disabled={returning}>
              {returning ? 'Processing…' : 'Process return & credit note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}
