import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  Mail,
  Printer,
  ShieldCheck,
  ShoppingBag,
  Undo2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { escapeHtml, numberToIndianWords } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dbApi } from '@/lib/api'
import type { Invoice } from '@/types'
import { formatCurrency, formatDateTime } from '@/lib/format'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [refunding, setRefunding] = useState(false)

  useEffect(() => {
    setLoading(true)
    dbApi.getInvoiceById(id ?? '').then((inv) => {
      setInvoice(inv ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
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
    // GST tax breakup: invoices are intra-state (CGST + SGST each at half the rate)
    const gstRate = Number(invoice.gst) || 0
    const taxable = Math.max(0, Number(invoice.subtotal) - Number(invoice.discount))
    const totalTax = Number(invoice.gstAmount) || 0
    const halfTax = Math.round((totalTax / 2) * 100) / 100
    const hsnCodes = [...new Set(invoice.items.map((i) => i.hsn).filter(Boolean))] as string[]
    const hsnDisplay = hsnCodes.length > 0 ? hsnCodes.join(', ') : '7113'
    const itemRows = invoice.items
      .map(
        (i) => `<tr>
          <td>${escapeHtml(i.product)}<br/><small>${escapeHtml(i.sku)}</small></td>
          <td align="center">${escapeHtml(i.hsn ?? hsnDisplay)}</td>
          <td align="right">${i.qty}</td>
          <td align="right">${i.weight.toFixed(2)} gm</td>
          <td align="right">₹${i.silverRate.toFixed(2)}/g</td>
          <td align="right">₹${i.makingCharge}/g</td>
          <td align="right">${i.tax}%</td>
          <td align="right">₹${i.amount.toFixed(2)}</td>
        </tr>`,
      )
      .join('')
    w.document.write(`<!doctype html><html><head><title>Tax Invoice ${escapeHtml(invoice.number)}</title><style>
      body{font-family:Arial,sans-serif;color:#111;margin:32px}
      h1{font-size:20px;margin:0} .sub{color:#64748b;font-size:12px;margin-bottom:4px}
      .gsthead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:16px}
      .badge{border:1.5px solid #111;padding:4px 12px;font-size:11px;font-weight:bold;letter-spacing:1px}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:16px}
      th{text-align:left;background:#f1f5f9;padding:7px;border:1px solid #cbd5e1} td{padding:7px;border:1px solid #e2e8f0}
      small{color:#64748b} .sum{float:right;font-size:12px;margin-top:16px;line-height:1.8;width:46%}
      .sum table{font-size:11px} .sum b{font-size:15px} .bill{margin-top:24px;font-size:12px}
      .bill b{display:block;margin-bottom:4px} .taxbreak{margin-top:8px}
      .note{margin-top:28px;font-size:10px;color:#475569;line-height:1.6}
      .amountinwords{margin-top:12px;font-size:11px;font-style:italic}
      @media print{body{margin:12mm}}
    </style></head><body>
      <div class="gsthead">
        <div>
          <h1>OPAL LINE JEWELS LLP</h1>
          <div class="sub">92.5 Sterling Silver Jewellery · GSTIN: ______________ · PAN: ______________</div>
          <div class="sub">State: ______________ · State Code: __ · E-commerce sale via Shopify</div>
        </div>
        <div class="badge">TAX INVOICE</div>
      </div>
      <div class="bill" style="margin-top:0;display:flex;justify-content:space-between">
        <div><b>Billed To</b>${escapeHtml(invoice.customer)}<br/>${escapeHtml(invoice.customerEmail) ?? ''}<br/>${escapeHtml(invoice.shopifyOrder ?? '')}</div>
        <div style="text-align:right"><b>Invoice Details</b>Invoice No: <b>${escapeHtml(invoice.number)}</b><br/>Date: ${formatDateTime(invoice.date)}<br/>Payment: ${escapeHtml(invoice.paymentMethod)} (${escapeHtml(invoice.paymentStatus)})</div>
      </div>
      <table>
        <thead><tr><th>Product</th><th align="center">HSN</th><th align="right">Qty</th><th align="right">Weight</th><th align="right">Silver Rate</th><th align="right">Making</th><th align="right">GST</th><th align="right">Amount</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="sum">
        <table class="taxbreak">
          <tr><td>Taxable Value</td><td align="right">₹${taxable.toFixed(2)}</td></tr>
          <tr><td>CGST @ ${gstRate / 2}%</td><td align="right">₹${halfTax.toFixed(2)}</td></tr>
          <tr><td>SGST @ ${gstRate / 2}%</td><td align="right">₹${halfTax.toFixed(2)}</td></tr>
          <tr><td>Total GST</td><td align="right">₹${totalTax.toFixed(2)}</td></tr>
          ${Number(invoice.discount) > 0 ? `<tr><td>Discount</td><td align="right">- ₹${Number(invoice.discount).toFixed(2)}</td></tr>` : ''}
          <tr><td><b>GRAND TOTAL</b></td><td align="right"><b>₹${Number(invoice.grandTotal).toFixed(2)}</b></td></tr>
        </table>
      </div>
      <div class="amountinwords">Amount in words: ${numberToIndianWords(Number(invoice.grandTotal))} Rupees Only</div>
      <div class="note">
        <b>Declaration:</b> We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
        Goods once sold will only be exchanged as per store policy. This is a computer-generated invoice.<br/><br/>
        <div style="display:flex;justify-content:space-between;margin-top:24px"><span>Customer Signature: ____________</span><span>For OPAL LINE JEWELS LLP<br/><br/>Authorised Signatory: ____________</span></div>
      </div>
      <script>window.onload=function(){window.focus();window.print();}</script>
    </body></html>`)
    w.document.close()
  }

  const emailInvoice = () => {
    const subject = encodeURIComponent(`Invoice ${invoice.number} from Opal Line`)
    const body = encodeURIComponent(
      `Hi ${invoice.customer},\n\nThank you for your order ${invoice.shopifyOrder}.\n\nInvoice ${invoice.number} — Total: ${formatCurrency(invoice.grandTotal)}\n\nRegards,\nOpal Line`,
    )
    window.location.href = `mailto:${invoice.customerEmail}?subject=${subject}&body=${body}`
  }

  const refundInvoice = async () => {
    if (!window.confirm(`Mark invoice ${invoice.number} as refunded? This cannot be undone.`)) return
    setRefunding(true)
    try {
      await dbApi.update('invoices', invoice.id, { status: 'refunded', paymentStatus: 'refunded' })
      setInvoice({ ...invoice, status: 'refunded', paymentStatus: 'refunded' })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setRefunding(false)
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
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-700 ring-1 ring-primary-100">
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
        subtitle={`Shopify Order ${invoice.shopifyOrder} · ${formatDateTime(invoice.date)}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={printInvoice}><Printer className="h-3.5 w-3.5" /> Print</Button>
            <Button variant="outline" size="sm" onClick={printInvoice}><Download className="h-3.5 w-3.5" /> Save as PDF</Button>
            <Button variant="outline" size="sm" onClick={emailInvoice}><Mail className="h-3.5 w-3.5" /> Email</Button>
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
                          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-700">
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
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shopify Order</span>
                    <span className="font-mono font-medium text-foreground">{invoice.shopifyOrder}</span>
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
                  {invoice.shopifyOrder} <ShoppingBag className="h-3 w-3" />
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
                Invoice generated automatically from Shopify order #{invoice.shopifyOrder.slice(1)}.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
