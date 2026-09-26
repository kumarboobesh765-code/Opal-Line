import { escapeHtml, numberToIndianWords } from '@/lib/utils'

/**
 * Shared print-template builder — one source of truth for printable documents.
 * The Print Designer page renders live previews with it AND the real print
 * flows (invoice detail, quotations) build their printouts with it, so a saved
 * design instantly applies to every document of that type.
 *
 * Keep the defaults in sync with backend/src/routes/printTemplates.ts
 * (defaultPrintConfig + sanitizePrintConfig); the backend clamps and stores
 * the config, this side renders it.
 */

export interface PrintDesignerConfig {
  accent: string
  headerStyle: 'banner' | 'minimal' | 'boxed'
  fontScale: number
  pageSize: 'a4' | 'letter'
  margins: { top: number; right: number; bottom: number; left: number }
  showLogo: boolean
  logoDataUrl: string | null
  showGSTIN: boolean
  showAmountWords: boolean
  showSignature: boolean
  showDeclaration: boolean
  showHsn: boolean
  showWeight: boolean
  showRate: boolean
  tableZebra: boolean
  footerNote: string
  thankYouNote: string
  declaration: string
  watermark: string | null
}

export const DEFAULT_PRINT_CONFIG: PrintDesignerConfig = {
  accent: '#c8a951',
  headerStyle: 'banner',
  fontScale: 1,
  pageSize: 'a4',
  margins: { top: 12, right: 12, bottom: 12, left: 12 },
  showLogo: false,
  logoDataUrl: null,
  showGSTIN: true,
  showAmountWords: true,
  showSignature: true,
  showDeclaration: true,
  showHsn: true,
  showWeight: true,
  showRate: true,
  tableZebra: true,
  footerNote: '',
  thankYouNote: 'Thank you for your business!',
  declaration:
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. Goods once sold will only be exchanged as per store policy. This is a computer-generated invoice.',
  watermark: null,
}

/** Merge a stored config over the defaults so new options never break old saves. */
export function mergePrintConfig(saved: unknown): PrintDesignerConfig {
  const s = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<string, unknown>
  const d = DEFAULT_PRINT_CONFIG
  const num = (v: unknown, min: number, max: number, fb: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb
  }
  const m = (typeof s.margins === 'object' && s.margins !== null ? s.margins : {}) as Record<string, unknown>
  return {
    accent: typeof s.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : d.accent,
    headerStyle: s.headerStyle === 'minimal' || s.headerStyle === 'boxed' ? s.headerStyle : 'banner',
    fontScale: num(s.fontScale, 0.8, 1.3, 1),
    pageSize: s.pageSize === 'letter' ? 'letter' : 'a4',
    margins: {
      top: num(m.top, 0, 40, 12),
      right: num(m.right, 0, 40, 12),
      bottom: num(m.bottom, 0, 40, 12),
      left: num(m.left, 0, 40, 12),
    },
    showLogo: s.showLogo === true && typeof s.logoDataUrl === 'string' && s.logoDataUrl.startsWith('data:image/'),
    logoDataUrl: typeof s.logoDataUrl === 'string' && s.logoDataUrl.startsWith('data:image/') ? s.logoDataUrl : null,
    showGSTIN: s.showGSTIN !== false,
    showAmountWords: s.showAmountWords !== false,
    showSignature: s.showSignature !== false,
    showDeclaration: s.showDeclaration !== false,
    showHsn: s.showHsn !== false,
    showWeight: s.showWeight !== false,
    showRate: s.showRate !== false,
    tableZebra: s.tableZebra !== false,
    footerNote: typeof s.footerNote === 'string' ? s.footerNote : '',
    thankYouNote: typeof s.thankYouNote === 'string' ? s.thankYouNote : d.thankYouNote,
    declaration: typeof s.declaration === 'string' ? s.declaration : d.declaration,
    watermark: typeof s.watermark === 'string' && s.watermark.trim() !== '' ? s.watermark.trim() : null,
  }
}

/** Minimal shape the builder needs — Invoice, Quotation and the sample doc all satisfy it. */
export interface PrintDoc {
  number: string
  shopifyOrder?: string
  customer: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerCity?: string | null
  customerState?: string | null
  customerPincode?: string | null
  businessName?: string
  businessGstin?: string | null
  businessAddress?: string | null
  businessPhone?: string | null
  businessEmail?: string | null
  gst: number
  gstAmount: number
  discount: number
  subtotal: number
  grandTotal: number
  paymentMethod?: string
  paymentStatus?: string
  date: string
  items?: Array<Record<string, unknown>>
}

export interface PrintDocExtras {
  docType: 'invoice' | 'quotation' | 'order'
  /** Sub-line under the business name in the header. */
  tagline?: string
  /** Extra key/value box (e.g. "Valid Until" on quotations). */
  extraBox?: { label: string; value: string }
  /** Extra line under the customer (e.g. quotation notes). */
  notes?: string
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

/**
 * Build the complete printable HTML document (A4/Letter, print-CSS ready).
 * The returned string is opened in a print window or embedded in an iframe.
 */
export function buildPrintHtml(doc: PrintDoc, config: PrintDesignerConfig, extras: PrintDocExtras): string {
  const c = config
  const items = doc.items ?? []
  const gstRate = Number(doc.gst) || 0
  const taxable = Math.max(0, Number(doc.subtotal) - Number(doc.discount))
  const totalTax = Number(doc.gstAmount) || 0
  const halfTax = Math.round((totalTax / 2) * 100) / 100
  const hsnCodes = [...new Set(items.map((i) => String(i.hsn ?? '')).filter(Boolean))]
  const hsnDisplay = hsnCodes.length > 0 ? hsnCodes.join(', ') : '7113'
  const totalWeight = items.reduce((a, i) => a + (Number(i.weight) || 0), 0)
  const totalQty = items.reduce((a, i) => a + (Number(i.qty) || 0), 0)
  const pageWidth = c.pageSize === 'letter' ? '216mm' : '210mm'

  const itemRows = items
    .map((i, idx) => {
      const zebra = c.tableZebra && idx % 2 === 0 ? 'background:#f8f9fa;' : ''
      return `<tr style="${zebra}">
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;">${escapeHtml(String(i.product ?? ''))}<br/><span style="color:#6b728b;font-size:9px;">${escapeHtml(String(i.sku ?? ''))}</span></td>
          ${c.showHsn ? `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:center;">${escapeHtml(String(i.hsn ?? hsnDisplay))}</td>` : ''}
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${Number(i.qty) || 0}</td>
          ${c.showWeight ? `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${(Number(i.weight) || 0).toFixed(2)}</td>` : ''}
          ${c.showRate ? `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${fmt(Number(i.silverRate) || 0)}</td><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">₹${fmt(Number(i.makingCharge) || 0)}</td>` : ''}
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;">${Number(i.tax) || 0}%</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;text-align:right;font-weight:600;">₹${fmt(Number(i.amount) || 0)}</td>
        </tr>`
    })
    .join('')

  const headCols =
    `<th>Product</th>` +
    (c.showHsn ? `<th style="text-align:center;">HSN</th>` : '') +
    `<th style="text-align:right;">Qty</th>` +
    (c.showWeight ? `<th style="text-align:right;">Weight (g)</th>` : '') +
    (c.showRate ? `<th style="text-align:right;">Rate (₹/g)</th><th style="text-align:right;">Making (₹)</th>` : '') +
    `<th style="text-align:right;">GST</th><th style="text-align:right;">Amount (₹)</th>`
  const footSpans =
    `<td colspan="${c.showHsn ? 2 : 1}" style="padding:8px 10px;border-top:2px solid ${c.accent};font-size:10px;">Total: ${totalQty} item(s)</td>` +
    `<td style="padding:8px 10px;border-top:2px solid ${c.accent};text-align:right;font-size:10px;">${totalQty}</td>` +
    (c.showWeight ? `<td style="padding:8px 10px;border-top:2px solid ${c.accent};text-align:right;font-size:10px;">${totalWeight.toFixed(2)} g</td>` : '') +
    (c.showRate ? `<td colspan="2"></td>` : '') +
    `<td style="padding:8px 10px;border-top:2px solid ${c.accent};text-align:right;font-size:11px;">₹${fmt(doc.subtotal)}</td>`

  const headerBlock =
    c.headerStyle === 'banner'
      ? `<div class="header-banner">
        ${c.showLogo && c.logoDataUrl ? `<img class="logo" src="${c.logoDataUrl}" alt="logo"/>` : ''}
        <div>
          <h1>${escapeHtml(doc.businessName || 'OPAL LINE JEWELS LLP')}</h1>
          <div class="sub">${escapeHtml(extras.tagline || '92.5 Sterling Silver Jewellery')}</div>
          ${c.showGSTIN && doc.businessGstin ? `<div class="sub">GSTIN: ${escapeHtml(doc.businessGstin)}</div>` : ''}
          ${doc.businessAddress ? `<div class="sub">${escapeHtml(doc.businessAddress)}</div>` : ''}
          ${doc.businessPhone || doc.businessEmail ? `<div class="sub">${[doc.businessPhone, doc.businessEmail].filter(Boolean).map((v) => escapeHtml(String(v))).join(' · ')}</div>` : ''}
          <div class="sub">${escapeHtml(extras.docType === 'quotation' ? 'Quotation' : extras.docType === 'order' ? 'Sales Order' : 'E-commerce sale via Shopify')}</div>
        </div>
        <div class="badge" style="background:${c.accent};">${escapeHtml(extras.docType === 'quotation' ? 'QUOTATION' : extras.docType === 'order' ? 'SALES ORDER' : 'TAX INVOICE')}</div>
      </div>`
      : c.headerStyle === 'minimal'
        ? `<div class="header-minimal">
        <div>
          <h1>${escapeHtml(doc.businessName || 'OPAL LINE JEWELS LLP')}</h1>
          <div class="sub">${escapeHtml(extras.tagline || '92.5 Sterling Silver Jewellery')}${c.showGSTIN && doc.businessGstin ? ` · GSTIN: ${escapeHtml(doc.businessGstin)}` : ''}</div>
        </div>
        <div class="minimal-badge" style="color:${c.accent};border-color:${c.accent};">${escapeHtml(extras.docType === 'quotation' ? 'QUOTATION' : extras.docType === 'order' ? 'SALES ORDER' : 'TAX INVOICE')}</div>
      </div>`
        : `<div class="header-boxed">
        <div class="boxed-inner" style="border-color:${c.accent};">
          ${c.showLogo && c.logoDataUrl ? `<img class="logo" src="${c.logoDataUrl}" alt="logo"/>` : ''}
          <div>
            <h1>${escapeHtml(doc.businessName || 'OPAL LINE JEWELS LLP')}</h1>
            <div class="sub" style="color:#6b728b;">${escapeHtml(extras.tagline || '92.5 Sterling Silver Jewellery')}${c.showGSTIN && doc.businessGstin ? ` · GSTIN: ${escapeHtml(doc.businessGstin)}` : ''}</div>
          </div>
          <div class="boxed-badge" style="background:${c.accent};">${escapeHtml(extras.docType === 'quotation' ? 'QUOTATION' : extras.docType === 'order' ? 'SALES ORDER' : 'TAX INVOICE')}</div>
        </div>
      </div>`

  const gstinLine =
    extras.docType !== 'order'
      ? `<div class="meta-line">${c.showGSTIN && doc.businessGstin ? `GSTIN: ${escapeHtml(doc.businessGstin)} · ` : ''}Intra-state supply · GST @ ${gstRate}%</div>`
      : `<div class="meta-line">Intra-state supply · GST @ ${gstRate}%</div>`

  const watermark = c.watermark
    ? `<div class="watermark" style="color:${c.accent};">${escapeHtml(c.watermark)}</div>`
    : ''

  return `<!doctype html><html><head><title>${escapeHtml(doc.number)}</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Inter',Arial,sans-serif;color:#1f2937;margin:0;padding:${c.margins.top}mm ${c.margins.right}mm ${c.margins.bottom}mm ${c.margins.left}mm;background:#fff;font-size:${(11 * c.fontScale).toFixed(1)}px;max-width:${pageWidth};}
      .header-banner{background:#1a1a2e;color:#fff;padding:16px 20px;border-radius:6px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;}
      .header-banner h1{font-size:${(20 * c.fontScale).toFixed(0)}px;font-weight:700;letter-spacing:0.5px;}
      .header-banner .sub{color:#a0aec0;font-size:${(9 * c.fontScale).toFixed(0)}px;margin-top:2px;}
      .header-banner .logo{max-height:44px;max-width:120px;object-fit:contain;}
      .badge{display:inline-block;padding:5px 16px;font-size:${(10 * c.fontScale).toFixed(0)}px;font-weight:700;letter-spacing:1.5px;border-radius:3px;color:#1a1a2e;white-space:nowrap;}
      .header-minimal{display:flex;justify-content:space-between;align-items:center;padding:6px 0 14px;border-bottom:2px solid #1a1a2e;margin-bottom:16px;}
      .header-minimal h1{font-size:${(18 * c.fontScale).toFixed(0)}px;font-weight:700;color:#1a1a2e;}
      .header-minimal .sub{color:#6b728b;font-size:${(9 * c.fontScale).toFixed(0)}px;margin-top:2px;}
      .minimal-badge{font-size:${(10 * c.fontScale).toFixed(0)}px;font-weight:700;letter-spacing:1.5px;border:2px solid;border-radius:3px;padding:4px 12px;white-space:nowrap;}
      .header-boxed{margin-bottom:16px;}
      .boxed-inner{display:flex;justify-content:space-between;align-items:center;gap:12px;border:2px solid;border-radius:8px;padding:14px 18px;}
      .header-boxed h1{font-size:${(18 * c.fontScale).toFixed(0)}px;font-weight:700;color:#1a1a2e;}
      .header-boxed .sub{font-size:${(9 * c.fontScale).toFixed(0)}px;margin-top:2px;}
      .header-boxed .logo{max-height:40px;max-width:110px;object-fit:contain;margin-right:10px;}
      .boxed-badge{color:#1a1a2e;font-size:${(10 * c.fontScale).toFixed(0)}px;font-weight:700;letter-spacing:1.5px;border-radius:3px;padding:5px 16px;white-space:nowrap;}
      .header-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
      .info-row{display:flex;gap:8px;flex:1;margin-right:16px;}
      .info-box{background:#f8f9fa;border-radius:4px;padding:12px 14px;flex:1;}
      .info-box .label{font-size:8px;font-weight:600;color:#6b728b;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}
      .info-box .value{font-size:12px;font-weight:600;color:#1f2937;}
      .info-box .detail{font-size:10px;color:#6b728b;margin-top:2px;}
      .billto-row{display:flex;gap:12px;margin-bottom:14px;}
      .billto-box{background:#f8f9fa;border-radius:4px;padding:12px 14px;flex:1;}
      .billto-box .label{font-size:8px;font-weight:600;color:#6b728b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}
      .billto-box .name{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:3px;}
      .billto-box .detail{font-size:10px;color:#6b728b;line-height:1.5;}
      .meta-line{font-size:10px;color:#6b728b;margin-bottom:14px;}
      table.items{width:100%;border-collapse:collapse;margin-bottom:16px;}
      table.items thead th{background:#1a1a2e;color:#fff;padding:8px 10px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:left;}
      table.items thead th:last-child{text-align:right;}
      table.items tbody td{padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;}
      .totals-box{float:right;width:260px;background:#f8f9fa;border-radius:4px;padding:14px;margin-bottom:16px;}
      .totals-box .row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:#374151;}
      .totals-box .grand{display:flex;justify-content:space-between;padding-top:8px;font-size:14px;font-weight:700;color:#1a1a2e;border-top:2px solid ${c.accent};margin-top:6px;}
      .amount-words{background:#fef3c7;border-radius:4px;padding:10px 14px;font-size:10px;color:#92400e;margin:16px 0;clear:both;}
      .amount-words b{color:#78350f;}
      .footer{border-top:1px solid #e5e7eb;padding-top:12px;margin-top:16px;clear:both;}
      .declaration{font-size:9px;color:#6b728b;line-height:1.6;margin-bottom:${c.showSignature ? '16px' : '4px'};max-width:65%;}
      .signatures{display:flex;justify-content:space-between;margin-top:20px;}
      .sig-block{text-align:center;width:140px;}
      .sig-line{border-top:1px solid #d1d5db;margin-top:40px;padding-top:4px;font-size:9px;color:#6b728b;}
      .gen-footer{text-align:center;font-size:8px;color:#9ca3af;margin-top:16px;padding-top:8px;border-top:1px solid #f3f4f6;}
      .footnote{font-size:9px;color:#6b728b;margin-top:10px;}
      .thanks{font-size:11px;font-weight:600;color:${c.accent};margin-top:8px;}
      .watermark{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:72px;font-weight:700;opacity:0.08;letter-spacing:8px;pointer-events:none;}
      @media print{
        body{font-size:10px;}
        .header-banner,.boxed-inner{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        table.items thead th{background:#1a1a2e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        .badge,.boxed-badge{background:${c.accent} !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        .watermark{display:none;}
      }
    </style></head><body>
      ${watermark}
      ${headerBlock}
      <div class="header-row">
        <div class="info-row">
          <div class="info-box">
            <div class="label">${extras.docType === 'quotation' ? 'Quotation No' : extras.docType === 'order' ? 'Order No' : 'Invoice No'}</div>
            <div class="value">${escapeHtml(doc.number)}</div>
          </div>
          <div class="info-box">
            <div class="label">Date</div>
            <div class="value">${escapeHtml(fmtDate(doc.date))}</div>
          </div>
          ${doc.paymentMethod ? `<div class="info-box"><div class="label">Payment</div><div class="value">${escapeHtml(doc.paymentMethod)}</div><div class="detail">${escapeHtml(doc.paymentStatus ?? '')}</div></div>` : ''}
          ${extras.extraBox ? `<div class="info-box"><div class="label">${escapeHtml(extras.extraBox.label)}</div><div class="value">${escapeHtml(extras.extraBox.value)}</div></div>` : ''}
        </div>
      </div>
      <div class="billto-row">
        <div class="billto-box">
          <div class="label">Bill To</div>
          <div class="name">${escapeHtml(doc.customer || 'Guest')}</div>
          <div class="detail">${[doc.customerEmail, doc.customerPhone].filter(Boolean).map((v) => escapeHtml(String(v))).join('<br/>')}</div>
          ${doc.customerAddress || doc.customerCity || doc.customerState || doc.customerPincode ? `<div class="detail" style="margin-top:4px;white-space:pre-line;">${escapeHtml([doc.customerAddress, [doc.customerCity, doc.customerState, doc.customerPincode].filter(Boolean).join(', ')].filter(Boolean).join('\n'))}</div>` : ''}
          ${extras.notes ? `<div class="detail" style="margin-top:6px;font-style:italic;">${escapeHtml(extras.notes)}</div>` : ''}
        </div>
        <div class="billto-box">
          <div class="label">Order Details</div>
          <div class="value">${escapeHtml(doc.shopifyOrder ?? '')}</div>
          ${gstinLine}
        </div>
      </div>
      <table class="items">
        <thead><tr>${headCols}</tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr style="background:#f8f9fa;font-weight:600;">${footSpans}</tr></tfoot>
      </table>
      <div class="totals-box">
        <div class="row"><span>Taxable Value</span><span>₹${fmt(taxable)}</span></div>
        ${gstRate > 0 ? `<div class="row"><span>CGST @ ${gstRate / 2}%</span><span>₹${fmt(halfTax)}</span></div><div class="row"><span>SGST @ ${gstRate / 2}%</span><span>₹${fmt(halfTax)}</span></div><div class="row"><span>Total GST</span><span>₹${fmt(totalTax)}</span></div>` : ''}
        ${Number(doc.discount) > 0 ? `<div class="row" style="color:#dc2626;"><span>Discount</span><span>- ₹${fmt(doc.discount)}</span></div>` : ''}
        <div class="grand"><span>GRAND TOTAL</span><span>₹${fmt(doc.grandTotal)}</span></div>
      </div>
      ${c.showAmountWords ? `<div class="amount-words"><b>Amount in Words:</b> ${escapeHtml(numberToIndianWords(Number(doc.grandTotal) || 0))} Rupees Only</div>` : ''}
      <div class="footer">
        ${c.showDeclaration ? `<div class="declaration"><b>Declaration:</b> ${escapeHtml(c.declaration)}</div>` : ''}
        ${c.footerNote ? `<div class="footnote">${escapeHtml(c.footerNote)}</div>` : ''}
        ${c.showSignature ? `<div class="signatures">
          <div class="sig-block"><div class="sig-line">Customer Signature</div></div>
          <div class="sig-block"><div class="sig-line">For ${escapeHtml(doc.businessName || 'OPAL LINE JEWELS LLP')}<br/><span style="font-size:8px;">Authorised Signatory</span></div></div>
        </div>` : ''}
        ${c.thankYouNote ? `<div class="thanks">${escapeHtml(c.thankYouNote)}</div>` : ''}
      </div>
      <div class="gen-footer">Generated by ${escapeHtml(doc.businessName || 'Opal Line')} ERP · opalline.in</div>
    </body></html>`
}

/** Open the built document in a print window (same UX as the existing flows). */
export function printDocument(doc: PrintDoc, config: PrintDesignerConfig, extras: PrintDocExtras): void {
  const w = window.open('', '_blank', 'width=900,height=760')
  if (!w) return
  w.opener = null
  w.document.write(buildPrintHtml(doc, config, extras) + `<script>window.onload=function(){window.focus();window.print();}</script>`)
  w.document.close()
}
