import { useState } from 'react'
import { Upload, FileText, Download, RefreshCw, Users, ShoppingCart, Check, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { backupApi } from '@/lib/api'

type ImportType = 'customers' | 'orders'
type Step = 'upload' | 'preview' | 'import' | 'done'

export default function ShopifyDataImportPage() {
  const [importType, setImportType] = useState<ImportType>('customers')
  const [step, setStep] = useState<Step>('upload')
  const [csvText, setCsvText] = useState('')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; updated: number; errors: string[] } | null>(null)
  const [enrichResult, setEnrichResult] = useState<{ enriched: number; failed: number } | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvText(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const parseCSV = async () => {
    if (!csvText.trim()) return
    setBusy('parse')
    try {
      const result = await backupApi.parseCSV(csvText)
      setParsedRows(result.rows)
      setParsedHeaders(result.headers)
      setStep('preview')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setBusy(null)
    }
  }

  const doImport = async () => {
    setBusy('import')
    try {
      let res
      if (importType === 'customers') {
        res = await backupApi.importCustomersCSV(parsedRows)
      } else {
        res = await backupApi.importOrdersCSV(parsedRows)
      }
      setResult(res)
      setStep('done')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const doEnrich = async (type: 'customers' | 'orders') => {
    setBusy(`enrich-${type}`)
    try {
      const res = type === 'customers' ? await backupApi.enrichCustomers() : await backupApi.enrichOrders()
      setEnrichResult(res)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setBusy(null)
    }
  }

  const reset = () => {
    setStep('upload')
    setCsvText('')
    setParsedRows([])
    setParsedHeaders([])
    setResult(null)
    setEnrichResult(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-700 ring-1 ring-primary-100">
              <Upload className="h-5 w-5" />
            </div>
            <span>Shopify Data Import</span>
          </span>
        }
        subtitle="Import customer and order data from Shopify via CSV or enrich existing records"
      />

      {/* Auto-enrich section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Auto-Enrich from Shopify API
          </CardTitle>
          <CardDescription>
            Fetch missing email, phone, and address data directly from Shopify using the GraphQL API
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => doEnrich('customers')}
            >
              {busy === 'enrich-customers' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              Enrich Customers
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => doEnrich('orders')}
            >
              {busy === 'enrich-orders' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
              Enrich Orders
            </Button>
          </div>
          {enrichResult && (
            <div className="mt-3 rounded-lg border border-success-200 bg-success-50 p-3 text-sm">
              <p className="font-medium text-success-700">
                <Check className="inline h-4 w-4" /> Enrichment complete
              </p>
              <p className="text-success-700/80">
                {enrichResult.enriched} enriched, {enrichResult.failed} failed
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* CSV Import section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> CSV Import
          </CardTitle>
          <CardDescription>
            Import data from a CSV file exported from Shopify Admin
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Import type selector */}
          <div className="flex gap-2">
            <Button
              variant={importType === 'customers' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setImportType('customers'); reset() }}
            >
              <Users className="h-3.5 w-3.5" /> Customers
            </Button>
            <Button
              variant={importType === 'orders' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setImportType('orders'); reset() }}
            >
              <ShoppingCart className="h-3.5 w-3.5" /> Orders
            </Button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={step === 'upload' ? 'default' : 'muted'}>1. Upload</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant={step === 'preview' ? 'default' : 'muted'}>2. Preview</Badge>
            <ArrowRight className="h-3 w-3" />
            <Badge variant={step === 'import' || step === 'done' ? 'default' : 'muted'}>3. Import</Badge>
          </div>

          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {importType === 'customers'
                  ? 'CSV columns: name, email, phone, address, shopify_id'
                  : 'CSV columns: order_number, customer, email, phone, total, date, status'}
              </p>
              <div className="flex gap-2">
                <label className="flex-1">
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <span><Upload className="h-3.5 w-3.5" /> Choose CSV File</span>
                  </Button>
                  <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              <textarea
                className="w-full rounded-lg border bg-muted/30 p-3 font-mono text-xs"
                rows={8}
                placeholder="Or paste CSV content here..."
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <Button onClick={parseCSV} disabled={!csvText.trim() || busy !== null}>
                {busy === 'parse' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                Parse & Preview
              </Button>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Found {parsedRows.length} rows with columns: {parsedHeaders.join(', ')}
              </p>
              <div className="max-h-[300px] overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {parsedHeaders.map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-b">
                        {parsedHeaders.map((h) => (
                          <td key={h} className="px-3 py-2">{row[h] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 20 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    Showing 20 of {parsedRows.length} rows
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>Back</Button>
                <Button onClick={doImport} disabled={busy !== null}>
                  {busy === 'import' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Import {parsedRows.length} Rows
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 'done' && result && (
            <div className="space-y-3">
              <div className="rounded-lg border border-success-200 bg-success-50 p-4">
                <p className="font-medium text-success-700">
                  <Check className="inline h-4 w-4" /> Import Complete
                </p>
                <div className="mt-2 space-y-1 text-sm text-success-700/80">
                  <p>✅ Imported: {result.imported}</p>
                  <p>🔄 Updated: {result.updated}</p>
                  {result.errors.length > 0 && (
                    <div className="mt-2">
                      <p className="text-red-600">⚠️ Errors:</p>
                      <ul className="list-disc pl-5 text-red-600/80">
                        {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                        {result.errors.length > 5 && <li>...and {result.errors.length - 5} more</li>}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={reset}>
                Import More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}