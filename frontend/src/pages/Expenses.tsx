import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@/lib/table'
import { CheckCircle2, Loader2, MoreHorizontal, Plus, Receipt, Search, User, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dbApi } from '@/lib/api'
import type { Expense } from '@/types'
import { formatCurrency, formatDateTime, todayIST } from '@/lib/format'

const thisMonthKey = todayIST().slice(0, 7)
const thisMonthLabel = new Date(`${thisMonthKey}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

const statusBadge: Record<Expense['status'], { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  approved: { label: 'Approved', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'muted' },
}

const EXPENSE_CATEGORIES = ['Marketing', 'Packaging', 'Shipping', 'Software', 'Labour', 'Rent', 'Utilities', 'Office', 'Other']

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ category: '', description: '', amount: '', paymentMethod: '' })

  const load = useCallback(() => {
    setLoading(true)
    dbApi.getExpenses().then((d) => {
      setExpenses(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const openDialog = () => {
    setForm({ category: '', description: '', amount: '', paymentMethod: 'UPI' })
    setError('')
    setDialogOpen(true)
  }

  const submit = async () => {
    const amount = parseFloat(form.amount)
    if (!form.category || !form.description.trim() || isNaN(amount) || amount <= 0) {
      setError('Fill in category, description and a valid amount')
      return
    }
    setSaving(true)
    setError('')
    try {
      await dbApi.create('expenses', {
        category: form.category,
        description: form.description.trim(),
        amount,
        paymentMethod: form.paymentMethod,
        date: new Date().toISOString(),
        status: 'pending',
        by: 'System User',
      })
      setDialogOpen(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add expense')
    } finally {
      setSaving(false)
    }
  }

  const approve = async (expense: Expense) => {
    try {
      await dbApi.update('expenses', expense.id, { status: 'approved' })
      load()
    } catch {
      window.alert('Failed to approve expense')
    }
  }

  const remove = async (expense: Expense) => {
    try {
      await dbApi.remove('expenses', expense.id)
      load()
    } catch {
      window.alert('Failed to delete expense')
    }
  }

  const categories = useMemo(() => [...new Set(expenses.map((e) => e.category))], [expenses])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return expenses.filter((e) => {
      const matchQ = !q || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.by ?? '').toLowerCase().includes(q)
      const matchStatus = !statusFilter || e.status === statusFilter
      const matchCategory = !categoryFilter || e.category === categoryFilter
      return matchQ && matchStatus && matchCategory
    })
  }, [expenses, query, statusFilter, categoryFilter])

  const totalAmount = expenses.reduce((a, e) => a + e.amount, 0)
  const approvedAmount = expenses.filter((e) => e.status === 'approved').reduce((a, e) => a + e.amount, 0)
  const pendingAmount = expenses.filter((e) => e.status === 'pending').reduce((a, e) => a + e.amount, 0)

  const columns = useMemo<ColumnDef<Expense>[]>(
    () => [
      {
        accessorKey: 'category',
        header: 'Expense',
        meta: { headerClassName: 'min-w-[200px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-50 text-warning-700">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-foreground">{row.original.category}</p>
              <p className="max-w-[240px] truncate text-[11px] text-muted-foreground">{row.original.description}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.amount)}</span>,
      },
      {
        accessorKey: 'paymentMethod',
        header: 'Method',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.paymentMethod}</span>,
      },
      {
        accessorKey: 'by',
        header: 'Recorded By',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <User className="h-3.5 w-3.5" /> {row.original.by}
          </span>
        ),
      },
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.date)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => {
          const s = statusBadge[row.original.status]
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
              {row.original.status !== 'approved' ? (
                <DropdownMenuItem onClick={() => approve(row.original)}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => remove(row.original)}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [approve, remove],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Expenses"
        subtitle="Operating expenses across marketing, packaging, shipping, labour and more."
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> Add Expense
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={Receipt} label="Total Expenses" value={formatCurrency(totalAmount)} sub="All time" tint="bg-primary-50 text-primary-700" />
        <MiniCard icon={CheckCircle2} label="Approved" value={formatCurrency(approvedAmount)} sub="Cleared expenses" tint="bg-success-50 text-success-700" />
        <MiniCard icon={Wallet} label="Pending" value={formatCurrency(pendingAmount)} sub="Awaiting approval" tint="bg-warning-50 text-warning-700" />
        <MiniCard icon={Receipt} label="This Month" value={formatCurrency(expenses.filter((e) => e.date.startsWith(thisMonthKey)).reduce((a, e) => a + e.amount, 0))} sub={thisMonthLabel} tint="bg-info-50 text-info-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search description, category, user..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              options={[
                { value: '', label: 'All Categories' },
                ...categories.map((c) => ({ value: c, label: c })),
              ]}
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              className="w-[170px]"
            />
            <Select
              options={[
                { value: '', label: 'All Status' },
                { value: 'approved', label: 'Approved' },
                { value: 'pending', label: 'Pending' },
                { value: 'rejected', label: 'Rejected' },
              ]}
              value={statusFilter}
              onValueChange={setStatusFilter}
              className="w-[140px]"
            />
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {expenses.length} expenses
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No expenses found"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>Record a new operating expense.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select
                  options={[{ value: '', label: 'Select...' }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))]}
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  className="w-full"
                />
              </Field>
              <Field label="Amount (₹)">
                <Input
                  type="number" min="0" step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Description">
              <Input
                placeholder="e.g. Instagram Ads — August campaign"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field label="Payment Method">
              <Select
                options={[
                  { value: 'UPI', label: 'UPI' },
                  { value: 'Bank Transfer', label: 'Bank Transfer' },
                  { value: 'Net Banking', label: 'Net Banking' },
                  { value: 'Card', label: 'Card' },
                  { value: 'Cash', label: 'Cash' },
                ]}
                value={form.paymentMethod}
                onValueChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}
                className="w-full"
              />
            </Field>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function MiniCard({ icon: Icon, label, value, sub, tint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tint: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
          {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </Card>
  )
}
