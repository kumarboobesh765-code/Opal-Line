import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@/lib/table'
import { Building2, CheckCircle2, History, Loader2, MapPin, Phone, Plus, Search, ShoppingCart, User, UserRoundPen, Wallet, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { dbApi } from '@/lib/api'
import { exportTable } from '@/lib/export'
import type { Supplier } from '@/types'
import { formatCurrency } from '@/lib/format'
import { initials } from '@/lib/utils'

export default function SuppliersPage() {
  const navigate = useNavigate()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', contact: '', phone: '', city: '' })

  const load = useCallback(() => {
    setLoading(true)
    dbApi.getSuppliers().then((d) => {
      setSuppliers(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return suppliers.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || (s.contact ?? '').toLowerCase().includes(q) || s.city.toLowerCase().includes(q),
    )
  }, [suppliers, query])

  const totalOutstanding = suppliers.reduce((a, s) => a + s.outstanding, 0)

  const openDialog = () => {
    setForm({ name: '', contact: '', phone: '', city: '' })
    setError('')
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setError('Supplier name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await dbApi.create('suppliers', {
        name: form.name.trim(),
        contact: form.contact.trim(),
        phone: form.phone.trim(),
        city: form.city.trim() || 'Mumbai',
        status: 'active',
        outstanding: 0,
      })
      setDialogOpen(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add supplier')
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (supplier: Supplier) => {
    try {
      await dbApi.update('suppliers', supplier.id, { status: 'inactive' })
      load()
    } catch {
      window.alert('Failed to deactivate supplier')
    }
  }

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Supplier',
        meta: { headerClassName: 'min-w-[220px]' },
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary-100 text-primary-700">{initials(row.original.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-foreground">{row.original.name}</p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <User className="h-2.5 w-2.5" /> {row.original.contact}
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
      {
        accessorKey: 'city',
        header: 'City',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" /> {row.original.city}
          </span>
        ),
      },
      {
        accessorKey: 'outstanding',
        header: 'Outstanding',
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span className={`font-semibold tabular-nums ${row.original.outstanding > 0 ? 'text-warning-700' : 'text-foreground'}`}>
            {formatCurrency(row.original.outstanding)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        meta: { align: 'center' as const },
        cell: ({ row }) => <Badge variant={row.original.status === 'active' ? 'success' : 'muted'} dot>{row.original.status}</Badge>,
      },
      {
        id: 'actions',
        header: 'Actions',
        meta: { align: 'right' as const, headerClassName: 'w-10' },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a href={`tel:${row.original.phone}`}>
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Call supplier</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => setViewSupplier(row.original)}>
                    <UserRoundPen className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>View supplier</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => navigate('/purchase/orders')}>
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Purchase history</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => navigate('/purchase/orders')}>
                    <ShoppingCart className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New purchase order</TooltipContent>
              </Tooltip>
              {row.original.status === 'active' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => deactivate(row.original)}>
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Deactivate supplier</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" onClick={() => dbApi.update('suppliers', row.original.id, { status: 'active' }).then(load).catch(() => window.alert('Failed to reactivate supplier'))}>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reactivate supplier</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>
        ),
      },
    ],
    [load],
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Suppliers"
        subtitle="Silver and jewellery material suppliers used across purchase orders and invoices."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportTable('suppliers.csv', columns, suppliers)}>
              <Phone className="h-3.5 w-3.5" /> Contact Book
            </Button>
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-4 w-4" /> Add Supplier
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={Building2} label="Total Suppliers" value={String(suppliers.length)} sub="All suppliers" tint="bg-primary-50 text-primary-700" />
        <MiniCard icon={Building2} label="Active" value={String(suppliers.filter((s) => s.status === 'active').length)} sub="Currently active" tint="bg-success-50 text-success-700" />
        <MiniCard icon={Wallet} label="Total Outstanding" value={formatCurrency(totalOutstanding)} sub="Payable to suppliers" tint="bg-warning-50 text-warning-700" />
        <MiniCard icon={Building2} label="Cities" value={String(new Set(suppliers.map((s) => s.city)).size)} sub="Supply locations" tint="bg-info-50 text-info-700" />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative min-w-[240px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search supplier, contact, city..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <DataTable
            onRowClick={(s) => setViewSupplier(s)}
            columns={columns}
            data={filtered}
            loading={loading}
            emptyMessage="No suppliers found"
          />
        </CardContent>
      </Card>

      <Dialog open={viewSupplier !== null} onOpenChange={(open) => { if (!open) setViewSupplier(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary-100 text-primary-700">{initials(viewSupplier?.name ?? '')}</AvatarFallback>
              </Avatar>
              {viewSupplier?.name}
            </DialogTitle>
            <DialogDescription>Supplier details</DialogDescription>
          </DialogHeader>
          {viewSupplier ? (
            <div className="space-y-0.5 text-sm">
              <DetailRow label="Contact" value={viewSupplier.contact || '—'} />
              <DetailRow label="Phone" value={viewSupplier.phone || '—'} />
              <DetailRow label="City" value={viewSupplier.city || '—'} />
              <DetailRow label="Outstanding" value={formatCurrency(viewSupplier.outstanding)} />
              <DetailRow label="Status" value={viewSupplier.status === 'active' ? 'Active' : 'Inactive'} />
            </div>
          ) : null}
          <DialogFooter>
            {viewSupplier?.phone ? (
              <Button variant="outline" onClick={() => (window.location.href = `tel:${encodeURI(viewSupplier.phone)}`)}>
                <Phone className="h-4 w-4" /> Call
              </Button>
            ) : null}
            <Button onClick={() => setViewSupplier(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>Register a new silver supplier.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Supplier Name">
              <Input
                placeholder="e.g. Goyal Silver House"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Person">
                <Input
                  placeholder="e.g. Ramesh Goyal"
                  value={form.contact}
                  onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                />
              </Field>
              <Field label="Phone">
                <Input
                  placeholder="+91 ..."
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="City">
              <Input
                placeholder="e.g. Mumbai"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </Field>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Supplier
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}
