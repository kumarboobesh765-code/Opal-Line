import { useEffect, useMemo, useState } from 'react'
import { Mail, MessageCircle, RefreshCw, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { dbApi } from '@/lib/api'
import { formatCurrency } from '@/lib/format'

interface CustomerDue {
  customer: string
  invoiceCount: number
  total: number
  oldestDate: string | null
  invoiceNumbers: string[]
}

interface DuesResponse {
  dues: CustomerDue[]
  total: number
  customerCount: number
}

function ageDays(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function ageLabel(dateStr: string | null): string {
  const d = ageDays(dateStr)
  if (d <= 30) return '0–30d'
  if (d <= 60) return '31–60d'
  if (d <= 90) return '61–90d'
  return '90+d'
}

function ageTone(dateStr: string | null): 'success' | 'warning' | 'danger' | 'muted' {
  const d = ageDays(dateStr)
  if (d <= 30) return 'warning'
  if (d <= 90) return 'danger'
  return 'danger'
}

export default function DuesPage() {
  const [data, setData] = useState<DuesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [customers, setCustomers] = useState<Array<{ name: string; phone?: string | null }>>([])

  const load = () => {
    setLoading(true)
    dbApi.getDues()
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false))
    dbApi.getCustomers().then(setCustomers).catch(() => undefined)
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!data) return []
    return data.dues.filter((d) => !q || d.customer.toLowerCase().includes(q) || d.invoiceNumbers.some((n) => n.toLowerCase().includes(q)))
  }, [data, query])

  const emailStatement = async () => {
    if (!window.confirm('Email the dues statement PDF to the notification address?')) return
    setEmailing(true)
    try {
      const res = await dbApi.emailDuesStatement()
      if (res.sent) window.alert(`Statement emailed to ${res.recipient} (₹${(res.total ?? 0).toLocaleString('en-IN')}).`)
      else window.alert(res.reason || 'Nothing to send.')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Email failed')
    } finally {
      setEmailing(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Outstanding Dues"
        subtitle="Customers with unpaid invoices — collect faster with one-tap WhatsApp reminders."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={emailStatement} disabled={emailing || !data || data.dues.length === 0}>
              <Mail className="h-3.5 w-3.5" /> Email Statement
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <Card className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading dues...</Card>
      ) : !data || data.dues.length === 0 ? (
        <Card className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Nothing outstanding</p>
          <p className="text-xs text-muted-foreground">Every invoice is settled — no dues to collect.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold tabular-nums text-red-600">{formatCurrency(data.total)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Customers with dues</p>
              <p className="text-xl font-bold text-foreground">{data.customerCount}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Oldest due</p>
              <p className="text-xl font-bold text-foreground">
                {Math.max(...data.dues.map((d) => ageDays(d.oldestDate)))} days
              </p>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="border-b border-border/60 p-4">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer or invoice number…" className="max-w-sm" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 text-right font-medium">Invoices</th>
                      <th className="px-4 py-3 font-medium">Invoice #s</th>
                      <th className="px-4 py-3 font-medium">Oldest</th>
                      <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                      <th className="px-4 py-3 text-right font-medium">Remind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.customer} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{d.customer}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.invoiceCount}</td>
                        <td className="max-w-[220px] px-4 py-3">
                          <span className="block truncate font-mono text-xs text-muted-foreground" title={d.invoiceNumbers.join(', ')}>
                            {d.invoiceNumbers.slice(0, 3).join(', ')}
                            {d.invoiceNumbers.length > 3 ? ` +${d.invoiceNumbers.length - 3}` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={ageTone(d.oldestDate)} dot>{ageLabel(d.oldestDate)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600">{formatCurrency(d.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {(() => {
                              const phone = customers.find((c) => c.name === d.customer)?.phone || ''
                              if (!phone) return <span className="text-xs text-muted-foreground">no phone</span>
                              return (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const digits = phone.replace(/\D/g, '')
                                    const withCc = digits.length === 10 ? '91' + digits : digits
                                    const text = encodeURIComponent(
                                      `Dear ${d.customer},\n\nGentle reminder: your outstanding balance with Opal Line is ₹${d.total.toLocaleString('en-IN')} (${d.invoiceCount} invoice${d.invoiceCount === 1 ? '' : 's'}: ${d.invoiceNumbers.join(', ')}).\n\nKindly arrange the payment at your earliest convenience.\n\nThank you!\n— Opal Line`,
                                    )
                                    window.open(`https://wa.me/${withCc}?text=${text}`, '_blank', 'noopener')
                                  }}
                                >
                                  <MessageCircle className="h-3.5 w-3.5" /> Remind
                                </Button>
                              )
                            })()}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No customers match.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
