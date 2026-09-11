import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import { Download, MoreHorizontal, Plus, Search, UserPlus, Users, Mail, Phone, ShoppingBag, CircleDollarSign } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { dbApi, shopifyApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { Customer } from '@/types'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { initials } from '@/lib/utils'

export default function CustomersPage() {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addCity, setAddCity] = useState('')
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null)

  useEffect(() => {
    dbApi.getCustomers().then((d) => {
      setCustomers(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const toggleStatus = async (c: Customer) => {
    const next = c.status === 'inactive' ? 'active' : 'inactive'
    try {
      await dbApi.update('customers', c.id, { status: next })
      setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: next } : x)))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const importFromShopify = async () => {
    setImporting(true)
    try {
      const res = await shopifyApi.sync(['customers'])
      window.alert(`Imported ${res.results.customers?.count ?? 0} customers from Shopify.`)
      await dbApi.getCustomers().then(setCustomers)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const saveCustomer = async (e: FormEvent) => {
    e.preventDefault()
    if (!addName.trim()) return
    setSaving(true)
    try {
      const created = await dbApi.create<Customer>('customers', {
        name: addName.trim(),
        email: addEmail.trim(),
        phone: addPhone.trim(),
        city: addCity.trim(),
        status: 'active',
        orders: 0,
        totalSpent: 0,
        joined: new Date().toISOString(),
      })
      setCustomers((prev) => [created, ...prev])
      setShowAdd(false)
      setAddName('')
      setAddEmail('')
      setAddPhone('')
      setAddCity('')
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create customer')
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
    )
  }, [customers, query])

  const totalSpend = customers.reduce((a, c) => a + c.totalSpent, 0)

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Customer',
        meta: { headerClassName: 'min-w-[200px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary-100 text-primary-700">{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-foreground">{row.original.name}</p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Mail className="h-2.5 w-2.5" /> {row.original.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.phone}</span>,
      },
      { accessorKey: 'city', header: 'City', cell: ({ row }) => <span>{row.original.city || row.original.province || '—'}</span> },
      {
        accessorKey: 'orders',
        header: 'Orders',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.orders)}</span>,
      },
      {
        accessorKey: 'totalSpent',
        header: 'Total Spent',
        meta: { align: 'right' as const },
        cell: ({ row }) => <span className="font-semibold tabular-nums text-foreground">{formatCurrency(row.original.totalSpent)}</span>,
      },
      {
        accessorKey: 'joined',
        header: 'Customer Since',
        cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.joined)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => <Badge variant={row.original.status === 'active' ? 'success' : 'muted'} dot>{row.original.status}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        meta: { align: 'right' as const, headerClassName: 'w-10' },
        cell: ({ row }) => {
          const c = row.original
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => (window.location.href = `tel:${encodeURI(c.phone ?? '')}`)}><Phone className="h-3.5 w-3.5" /> Call</DropdownMenuItem>
                <DropdownMenuItem onClick={() => (window.location.href = `mailto:${encodeURI(c.email ?? '')}`)}><Mail className="h-3.5 w-3.5" /> Email</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/sales/invoices')}>View Order History</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => toggleStatus(c)}>
                  {c.status === 'inactive' ? 'Activate' : 'Deactivate'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Customers"
        subtitle="Ecommerce customers who purchased through the Opal Line Shopify store."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportTable('customers.csv', columns, filtered)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={importFromShopify} disabled={importing}>
              <UserPlus className="h-3.5 w-3.5" /> {importing ? 'Importing...' : 'Import from Shopify'}
            </Button>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" /> Add Customer
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile icon={Users} label="Total Customers" value={String(customers.length)} sub={`${customers.filter((c) => c.status === 'active').length} active`} tint="bg-primary-50 text-primary-700" />
        <SummaryTile icon={Mail} label="Email Subscribers" value={String(customers.filter((c) => c.email).length)} sub="With email on file" tint="bg-info-50 text-info-700" />
        <SummaryTile icon={ShoppingBag} label="Repeat Customers" value={String(customers.filter((c) => (c.orders ?? 0) >= 2).length)} sub="More than 1 order" tint="bg-success-50 text-success-700" />
        <SummaryTile icon={CircleDollarSign} label="Lifetime Value" value={formatCurrency(totalSpend)} sub="All customers" tint="bg-warning-50 text-warning-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span> of {customers.length} customers
            </div>
          </div>

          <DataTable
            onRowClick={(c) => setViewCustomer(c)}
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No customers found"
          />
        </CardContent>
      </Card>

      <Dialog open={viewCustomer !== null} onOpenChange={(open) => { if (!open) setViewCustomer(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary-100 text-primary-700">{initials(viewCustomer?.name ?? '')}</AvatarFallback>
              </Avatar>
              {viewCustomer?.name}
            </DialogTitle>
            <DialogDescription>Customer details and activity</DialogDescription>
          </DialogHeader>
          {viewCustomer ? (
            <div className="space-y-0.5 text-sm">
              <DetailRow label="Email" value={viewCustomer.email || '—'} />
              <DetailRow label="Phone" value={viewCustomer.phone || '—'} />
              <DetailRow label="City" value={[viewCustomer.city, viewCustomer.province].filter(Boolean).join(', ') || '—'} />
              <DetailRow label="Total Orders" value={formatNumber(viewCustomer.orders)} />
              <DetailRow label="Total Spent" value={formatCurrency(viewCustomer.totalSpent)} />
              <DetailRow label="Customer Since" value={formatDate(viewCustomer.joined)} />
              <DetailRow
                label="Status"
                value={viewCustomer.status === 'active' ? 'Active' : 'Inactive'}
              />
              {viewCustomer.shopifyId ? <DetailRow label="Shopify ID" value={viewCustomer.shopifyId} /> : null}
              {viewCustomer.emailVerified != null && viewCustomer.email ? (
                <DetailRow label="Email Verified" value={viewCustomer.emailVerified ? 'Yes' : 'No'} />
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            {viewCustomer?.phone ? (
              <Button variant="outline" onClick={() => (window.location.href = `tel:${encodeURI(viewCustomer.phone)}`)}>
                <Phone className="h-4 w-4" /> Call
              </Button>
            ) : null}
            {viewCustomer?.email ? (
              <Button variant="outline" onClick={() => (window.location.href = `mailto:${encodeURI(viewCustomer.email)}`)}>
                <Mail className="h-4 w-4" /> Email
              </Button>
            ) : null}
            <Button onClick={() => { setViewCustomer(null); navigate('/sales/invoices') }}>
              <ShoppingBag className="h-4 w-4" /> Order History
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
            <DialogDescription>Create a new customer record.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveCustomer} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cust-name">Name</Label>
              <Input id="cust-name" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cust-email">Email</Label>
                <Input id="cust-email" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="name@example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-phone">Phone</Label>
                <Input id="cust-phone" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="+91..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cust-city">City</Label>
              <Input id="cust-city" value={addCity} onChange={(e) => setAddCity(e.target.value)} placeholder="City" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !addName.trim()}>{saving ? 'Saving...' : 'Save Customer'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryTile({ icon: Icon, label, value, sub, tint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tint: string }) {
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}
