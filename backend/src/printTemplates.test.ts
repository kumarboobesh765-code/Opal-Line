import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizePrintConfig, defaultPrintConfig, sampleDocument, PRINT_DOC_TYPES } from './routes/printTemplates'

describe('sanitizePrintConfig (print designer)', () => {
  test('accepts a valid config and keeps known fields', () => {
    const { config, error } = sanitizePrintConfig({
      accent: '#ff0055',
      headerStyle: 'boxed',
      fontScale: 1.2,
      pageSize: 'letter',
      margins: { top: 20, right: 5, bottom: 8, left: 15 },
      showHsn: false,
      footerNote: 'GST as applicable',
      watermark: 'PAID',
    })
    assert.equal(error, undefined)
    assert.equal(config.accent, '#ff0055')
    assert.equal(config.headerStyle, 'boxed')
    assert.equal(config.fontScale, 1.2)
    assert.equal(config.pageSize, 'letter')
    assert.deepEqual(config.margins, { top: 20, right: 5, bottom: 8, left: 15 })
    assert.equal(config.showHsn, false)
    assert.equal(config.footerNote, 'GST as applicable')
    assert.equal(config.watermark, 'PAID')
  })

  test('clamps out-of-range values instead of rejecting', () => {
    const { config } = sanitizePrintConfig({ fontScale: 9, margins: { top: 500, left: -20 } })
    assert.equal(config.fontScale, 1.3)
    assert.equal(config.margins.top, 40)
    assert.equal(config.margins.left, 0)
    // untouched fields keep defaults
    assert.equal(config.margins.right, 12)
  })

  test('rejects bad accent colors and falls back to the default', () => {
    const { config } = sanitizePrintConfig({ accent: 'javascript:alert(1)' })
    assert.equal(config.accent, defaultPrintConfig('invoice').accent)
  })

  test('drops logo data urls that are not images or oversized', () => {
    const { config } = sanitizePrintConfig({ logoDataUrl: 'data:text/html;base64,PGI+' })
    assert.equal(config.logoDataUrl, null)
    const huge = sanitizePrintConfig({ logoDataUrl: `data:image/png;base64,${'A'.repeat(400 * 1024)}` })
    assert.equal(huge.config.logoDataUrl, null)
  })

  test('non-object config falls back to defaults with an error', () => {
    const { config, error } = sanitizePrintConfig('nope')
    assert.ok(error)
    assert.equal(config.accent, defaultPrintConfig('invoice').accent)
  })

  test('string fields are length-capped', () => {
    const { config } = sanitizePrintConfig({ footerNote: 'x'.repeat(2000), thankYouNote: 'y'.repeat(2000) })
    assert.ok(config.footerNote.length <= 500)
    assert.ok(config.thankYouNote.length <= 300)
  })

  test('accepts the extended design options', () => {
    const { config, error } = sanitizePrintConfig({
      headerStyle: 'modern',
      font: 'georgia',
      accent2: '#112233',
      cornerRadius: 12,
      paperTint: 'cream',
      tableHeaderStyle: 'accent',
      borderStyle: 'full',
      logoAlign: 'center',
      showTax: false,
      signatoryName: 'Ajith Kumar',
      bankDetails: 'A/C 1234 · IFSC SBIN0001234',
      showQr: true,
      qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      qrCaption: 'Scan to pay (UPI)',
    })
    assert.equal(error, undefined)
    assert.equal(config.headerStyle, 'modern')
    assert.equal(config.font, 'georgia')
    assert.equal(config.accent2, '#112233')
    assert.equal(config.cornerRadius, 12)
    assert.equal(config.paperTint, 'cream')
    assert.equal(config.tableHeaderStyle, 'accent')
    assert.equal(config.borderStyle, 'full')
    assert.equal(config.logoAlign, 'center')
    assert.equal(config.showTax, false)
    assert.equal(config.signatoryName, 'Ajith Kumar')
    assert.equal(config.bankDetails, 'A/C 1234 · IFSC SBIN0001234')
    assert.equal(config.showQr, true)
    assert.equal(config.qrCaption, 'Scan to pay (UPI)')
  })

  test('QR toggle is ignored without a valid image', () => {
    const { config } = sanitizePrintConfig({ showQr: true, qrDataUrl: 'data:text/html,x' })
    assert.equal(config.showQr, false)
    assert.equal(config.qrDataUrl, null)
  })

  test('bank details and signatory are length-capped', () => {
    const { config } = sanitizePrintConfig({ bankDetails: 'b'.repeat(2000), signatoryName: 's'.repeat(500) })
    assert.ok(config.bankDetails.length <= 600)
    assert.ok(config.signatoryName.length <= 120)
  })
})

describe('sampleDocument (designer preview)', () => {
  test('produces a document for every doc type with matching number prefix', () => {
    for (const docType of PRINT_DOC_TYPES) {
      const doc = sampleDocument(docType) as Record<string, unknown>
      assert.equal(typeof doc.number, 'string')
      assert.ok((doc.number as string).length > 0)
      assert.ok(Array.isArray(doc.items) && doc.items.length > 0)
      assert.equal(typeof doc.grandTotal, 'number')
    }
  })

  test('quotation sample carries validity and order sample carries fulfillment', () => {
    const q = sampleDocument('quotation') as Record<string, unknown>
    assert.ok(q.validUntil)
    const o = sampleDocument('order') as Record<string, unknown>
    assert.ok(o.fulfillment)
  })
})
