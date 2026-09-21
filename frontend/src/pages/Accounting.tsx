import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  Calculator,
  DollarSign,
  FileSpreadsheet,
  Landmark,
  Loader2,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { accountingApi } from '@/lib/api'
import type {
  TrialBalanceResult,
  ProfitAndLossResult,
  BalanceSheetResult,
  JournalEntry,
} from '@/lib/api'
import { formatCurrency } from '@/lib/format'

export default function AccountingPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Double-Entry Accounting"
        subtitle="Profit & Loss, Balance Sheet, Trial Balance and Journal Entries"
      />
      <Tabs defaultValue="trial-balance">
        <TabsList>
          <TabsTrigger value="trial-balance"><Scale className="h-4 w-4" /> Trial Balance</TabsTrigger>
          <TabsTrigger value="profit-loss"><TrendingUp className="h-4 w-4" /> Profit & Loss</TabsTrigger>
          <TabsTrigger value="balance-sheet"><Landmark className="h-4 w-4" /> Balance Sheet</TabsTrigger>
          <TabsTrigger value="journal"><BookOpen className="h-4 w-4" /> Journal Entries</TabsTrigger>
        </TabsList>
        <TabsContent value="trial-balance"><TrialBalanceTab /></TabsContent>
        <TabsContent value="profit-loss"><ProfitLossTab /></TabsContent>
        <TabsContent value="balance-sheet"><BalanceSheetTab /></TabsContent>
        <TabsContent value="journal"><JournalEntriesTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRIAL BALANCE
// ═══════════════════════════════════════════════════════════════════
function TrialBalanceTab() {
  const [data, setData] = useState<TrialBalanceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await accountingApi.getTrialBalance({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setData(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
            </div>
            <Button variant="outline" size="sm" onClick={load}>Apply Filters</Button>
            {data && (
              <Badge variant={data.isBalanced ? 'success' : 'danger'} className="ml-auto">
                {data.isBalanced ? '✓ Balanced' : '⚠ Unbalanced'}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trial balance...
        </Card>
      ) : !data || data.accounts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Calculator className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No accounts found. Create accounts and post journal entries to populate the trial balance.</p>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trial Balance</CardTitle>
            <CardDescription>All accounts with debit/credit totals</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Debit (₹)</TableHead>
                  <TableHead className="text-right">Credit (₹)</TableHead>
                  <TableHead className="text-right">Balance (₹)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell className="font-mono text-xs">{row.accountCode}</TableCell>
                    <TableCell className="font-medium">{row.accountName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">{row.accountType}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(row.totalDebit) > 0 ? formatCurrency(row.totalDebit) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(row.totalCredit) > 0 ? formatCurrency(row.totalCredit) : '—'}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${Number(row.balance) >= 0 ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
                      {Number(row.balance) >= 0 ? '+' : ''}{formatCurrency(row.balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-primary-200 bg-muted/50 font-bold">
                  <TableCell colSpan={3}>Totals</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(data.totalDebit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(data.totalCredit)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${data.isBalanced ? 'text-success-700' : 'text-red-600 dark:text-red-400'}`}>
                    {data.isBalanced ? 'Balanced ✓' : `Difference: ${formatCurrency(Math.abs(data.totalDebit - data.totalCredit))}`}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PROFIT & LOSS
// ═══════════════════════════════════════════════════════════════════
function ProfitLossTab() {
  const [data, setData] = useState<ProfitAndLossResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await accountingApi.getProfitAndLoss({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setData(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
            </div>
            <Button variant="outline" size="sm" onClick={load}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading P&L statement...
        </Card>
      ) : !data ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <DollarSign className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No financial data available. Post journal entries to populate the P&L statement.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-700">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Revenue</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalRevenue)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
                  <TrendingDown className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Expenses</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalExpenses)}</p>
                </div>
              </div>
            </Card>
            <Card className={`p-4 ${data.netProfit >= 0 ? 'ring-2 ring-success-200' : 'ring-2 ring-red-200'}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${data.netProfit >= 0 ? 'bg-success-50 text-success-700' : 'bg-red-50 text-red-700'}`}>
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Net Profit</p>
                  <p className={`text-lg font-bold ${data.netProfit >= 0 ? 'text-success-700' : 'text-red-700'}`}>{formatCurrency(data.netProfit)}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Revenue</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.revenue.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No revenue accounts</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount (₹)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.revenue.map((r) => (
                        <TableRow key={r.accountId}>
                          <TableCell>
                            <span className="font-mono text-[10px] text-muted-foreground mr-2">{r.accountCode}</span>
                            {r.accountName}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-success-700">{formatCurrency(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total Revenue</TableCell>
                        <TableCell className="text-right tabular-nums text-success-700">{formatCurrency(data.totalRevenue)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Expenses</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.expenses.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No expense accounts</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount (₹)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.expenses.map((r) => (
                        <TableRow key={r.accountId}>
                          <TableCell>
                            <span className="font-mono text-[10px] text-muted-foreground mr-2">{r.accountCode}</span>
                            {r.accountName}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-red-600 dark:text-red-400">{formatCurrency(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total Expenses</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">{formatCurrency(data.totalExpenses)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className={`p-5 ${data.netProfit >= 0 ? 'border-success-200 bg-success-50/30' : 'border-red-200 bg-red-50/30'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Net Profit / (Loss)</span>
              <span className={`text-xl font-bold ${data.netProfit >= 0 ? 'text-success-700' : 'text-red-700'}`}>
                {data.netProfit >= 0 ? '+' : ''}{formatCurrency(data.netProfit)}
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// BALANCE SHEET
// ═══════════════════════════════════════════════════════════════════
function BalanceSheetTab() {
  const [data, setData] = useState<BalanceSheetResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    accountingApi.getBalanceSheet().then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading balance sheet...
        </Card>
      ) : !data ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Landmark className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No balance sheet data available.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info-50 text-info-700">
                  <Landmark className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Assets</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalAssets)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-50 text-warning-700">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Liabilities</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalLiabilities)}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-50 text-success-700">
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Equity</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(data.totalEquity)}</p>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Assets</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data.assets.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-muted-foreground">No asset accounts</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Balance (₹)</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.assets.map((r) => (
                        <TableRow key={r.accountId}>
                          <TableCell>
                            <span className="font-mono text-[10px] text-muted-foreground mr-2">{r.accountCode}</span>
                            {r.accountName}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(r.balance)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total Assets</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(data.totalAssets)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Liabilities</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {data.liabilities.length === 0 ? (
                    <p className="px-5 py-4 text-xs text-muted-foreground">No liability accounts</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Balance (₹)</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.liabilities.map((r) => (
                          <TableRow key={r.accountId}>
                            <TableCell>
                              <span className="font-mono text-[10px] text-muted-foreground mr-2">{r.accountCode}</span>
                              {r.accountName}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(r.balance)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell>Total Liabilities</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(data.totalLiabilities)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Equity</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {data.equity.length === 0 ? (
                    <p className="px-5 py-4 text-xs text-muted-foreground">No equity accounts</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Account</TableHead><TableHead className="text-right">Balance (₹)</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.equity.map((r) => (
                          <TableRow key={r.accountId}>
                            <TableCell>
                              <span className="font-mono text-[10px] text-muted-foreground mr-2">{r.accountCode}</span>
                              {r.accountName}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(r.balance)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-bold">
                          <TableCell>Total Equity</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(data.totalEquity)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Liabilities + Equity</span>
              <span className="font-semibold tabular-nums">{formatCurrency(data.totalLiabilities + data.totalEquity)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">Assets = Liabilities + Equity</span>
              <Badge variant={Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) < 0.01 ? 'success' : 'danger'}>
                {Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)) < 0.01 ? 'Balanced ✓' : '⚠ Difference: ' + formatCurrency(Math.abs(data.totalAssets - (data.totalLiabilities + data.totalEquity)))}
              </Badge>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// JOURNAL ENTRIES
// ═══════════════════════════════════════════════════════════════════
function JournalEntriesTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await accountingApi.getJournalEntries({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })
      setEntries(res)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[160px]" />
            </div>
            <Button variant="outline" size="sm" onClick={load}>Apply Filters</Button>
            <div className="ml-auto text-xs text-muted-foreground">
              {entries.length} entries
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading journal entries...
        </Card>
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No journal entries found. Entries are auto-created when invoices are posted.</p>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-center">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs font-medium">{e.entryNumber}</TableCell>
                    <TableCell className="text-sm">{e.date}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.description || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{e.reference || '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={e.isAuto ? 'info' : 'outline'} className="text-[10px]">
                        {e.isAuto ? 'Auto' : 'Manual'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
