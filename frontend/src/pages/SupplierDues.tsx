import { toast } from '@/components/ui/confirm'
import { useEffect, useMemo, useState } from 'react'
import { IndianRupee, RefreshCw, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { dbApi } from '@/lib/api'
import { formatCurrency } from '@/lib/format'

interface SupplierDue {
  supplier: string
  count: number
  total: number
  oldestDate: string | null
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

export default function SupplierDuesPage() {
  const [data, setData] = useState<{ dues: SupplierDue[]; total: number; supplierCount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [payFor, setPayFor] = useState<SupplierDue | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('bank-transfer')
  const [paySaving, setPaySaving] = useState(false)

  const load = () => {
    setLoading(true)
    dbApi.getSupplierDues()
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!data) return []
    return data.dues.filter((d) => !q || d.supplier.toLowerCase().includes(q))
  }, [data, query])

  const openPayDialog = (d: SupplierDue) => {
    setPayFor(d)
    setPayAmount(String(d.total))
    setPayMethod('bank-transfer')
  }

  const submitPayment = async () => {
    if (!payFor) return
    const amount = Number(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    setPaySaving(true)
    try {
      const res = await dbApi.recordSupplierPayment({ supplier: payFor.supplier, amount, method: payMethod })
      toast.success(`Payment ${res.ref} recorded to ${payFor.supplier}`)
      setPayFor(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPaySaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Supplier Dues"
        subtitle="Outstanding purchase invoices — pay suppliers and track aging."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      {loading && !data ? (
        <Card className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading supplier dues...</Card>
      ) : !data || data.dues.length === 0 ? (
        <Card className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <Wallet className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground">No outstanding purchase invoices.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(data.total)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suppliers with dues</p>
              <p className="text-xl font-bold text-foreground">{data.supplierCount}</p>
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
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier name…" className="max-w-sm" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Supplier</th>
                      <th className="px-4 py-3 text-right font-medium">Invoices</th>
                      <th className="px-4 py-3 font-medium">Oldest</th>
                      <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                      <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.supplier} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{d.supplier}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.count}</td>
                        <td className="px-4 py-3">
                          <Badge variant={ageTone(d.oldestDate)} dot>{ageLabel(d.oldestDate)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(d.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="outline" size="sm" onClick={() => openPayDialog(d)}>
                            <IndianRupee className="h-3.5 w-3.5" /> Pay
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">No suppliers match.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={payFor !== null} onOpenChange={(open) => { if (!open) setPayFor(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay Supplier — {payFor?.supplier}</DialogTitle>
            <DialogDescription>
              Outstanding {formatCurrency(payFor?.total ?? 0)} across {payFor?.count ?? 0} purchase invoice(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pay-amount">Amount (₹)</Label>
              <Input id="pay-amount" type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select
                options={[
                  { value: 'bank-transfer', label: 'Bank Transfer' },
                  { value: 'upi', label: 'UPI' },
                  { value: 'cash', label: 'Cash' },
                ]}
                value={payMethod}
                onValueChange={setPayMethod}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>Cancel</Button>
            <Button onClick={submitPayment} disabled={paySaving || !payAmount}>
              {paySaving ? 'Saving…' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
