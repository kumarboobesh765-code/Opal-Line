import { useEffect, useState } from 'react'
import { Bell, Building2, Check, Landmark, Loader2, Monitor, Moon, Save, Settings as SettingsIcon, SlidersHorizontal, Sun, Tag, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RequireModule } from '@/components/RequirePermission'
import { dbApi } from '@/lib/api'
import { setTheme, type Theme } from '@/lib/theme'
import type { AppSettings } from '@/types'

const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  businessName: '',
  gstin: '',
  phone: '',
  email: '',
  address: '',
  defaultPurity: 92.5,
  makingCharge: 18,
  gstRate: 3,
  currency: 'inr',
  invoicePrefix: 'SI',
  rateSource: 'mcx',
  autoUpdateMcx: true,
  requireRateApproval: true,
  autoReconcileRazorpay: true,
  paymentReminders: false,
  lowStockAlerts: true,
  dailySummary: true,
  orderImports: true,
  updatedAt: null,
}

export default function SettingsPage() {
  return (
    <RequireModule module="system">
      <SettingsContent />
    </RequireModule>
  )
}

function SettingsContent() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    dbApi
      .getSettings()
      .then((row) => {
        if (row) setSettings({ ...DEFAULT_SETTINGS, ...row })
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
    setStatus('idle')
  }

  const save = async () => {
    setSaving(true)
    setStatus('idle')
    setError('')
    try {
      const saved = await dbApi.updateSettings(settings)
      setSettings((s) => ({ ...s, ...saved }))
      setStatus('saved')
    } catch (e) {
      setError('Failed to save settings')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Settings"
        subtitle="Business profile, silver-rate preferences, notifications and integrations."
        actions={
          <>
            {status === 'saved' ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-success-600">
                <Check className="h-4 w-4" /> Saved
              </span>
            ) : null}
            {status === 'error' ? <span className="text-sm font-medium text-red-600 dark:text-red-400">{error}</span> : null}
            <Button size="sm" onClick={save} disabled={saving || !loaded}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        }
      />

      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business"><Building2 /> Business</TabsTrigger>
          <TabsTrigger value="appearance"><Sun /> Appearance</TabsTrigger>
          <TabsTrigger value="silver"><Tag /> Silver Rate</TabsTrigger>
          <TabsTrigger value="banking"><Landmark /> Banking</TabsTrigger>
          <TabsTrigger value="notifications"><Bell /> Notifications</TabsTrigger>
          <TabsTrigger value="team"><Users /> Team</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance">
          <AppearanceCard />
        </TabsContent>

        <TabsContent value="business">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">Business Profile</h3>
                </div>
                <Field label="Business Name">
                  <Input value={settings.businessName} onChange={(e) => set('businessName', e.target.value)} />
                </Field>
                <Field label="GSTIN">
                  <Input value={settings.gstin} onChange={(e) => set('gstin', e.target.value)} />
                </Field>
                <Field label="Phone">
                  <Input value={settings.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
                <Field label="Email">
                  <Input value={settings.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field label="Address">
                  <Input value={settings.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">Defaults</h3>
                </div>
                <Field label="Default Silver Purity">
                  <Select
                    options={[
                      { value: '92.5', label: '92.5% (Sterling)' },
                      { value: '95.8', label: '95.8% (Britannia)' },
                      { value: '99.9', label: '99.9% (Fine)' },
                    ]}
                    value={String(settings.defaultPurity)}
                    onValueChange={(v) => set('defaultPurity', Number(v))}
                    className="w-full"
                  />
                </Field>
                <Field label="Making Charge (₹/g)">
                  <Input type="number" value={settings.makingCharge} onChange={(e) => set('makingCharge', Number(e.target.value))} />
                </Field>
                <Field label="GST Rate (%)">
                  <Input type="number" value={settings.gstRate} onChange={(e) => set('gstRate', Number(e.target.value))} />
                </Field>
                <Field label="Currency">
                  <Select
                    options={[
                      { value: 'inr', label: 'Indian Rupee (₹)' },
                      { value: 'usd', label: 'US Dollar ($)' },
                    ]}
                    value={settings.currency}
                    onValueChange={(v) => set('currency', v)}
                    className="w-full"
                  />
                </Field>
                <Field label="Invoice Prefix">
                  <Input value={settings.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} />
                </Field>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="silver">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Silver Rate Settings</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Rate Source">
                  <Select
                    options={[
                      { value: 'mcx', label: 'MCX Mumbai' },
                      { value: 'manual', label: 'Manual Entry' },
                    ]}
                    value={settings.rateSource}
                    onValueChange={(v) => set('rateSource', v)}
                    className="w-full"
                  />
                </Field>
              </div>
              <SettingRow
                title="Auto-update from MCX"
                description="Fetch daily silver closing rate automatically."
                checked={settings.autoUpdateMcx}
                onCheckedChange={(v) => set('autoUpdateMcx', v)}
              />
              <SettingRow
                title="Require admin approval for rate changes"
                description="Price changes must be approved before applying to Shopify."
                checked={settings.requireRateApproval}
                onCheckedChange={(v) => set('requireRateApproval', v)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="banking">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Payment & Settlement</h3>
              </div>
              <SettingRow
                title="Auto-reconcile Razorpay settlements"
                description="Match incoming Razorpay payments to invoices automatically."
                checked={settings.autoReconcileRazorpay}
                onCheckedChange={(v) => set('autoReconcileRazorpay', v)}
              />
              <SettingRow
                title="Send payment reminders for overdue invoices"
                description="Automatically email customers after 7 days past due."
                checked={settings.paymentReminders}
                onCheckedChange={(v) => set('paymentReminders', v)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Notifications</h3>
              </div>
              <SettingRow
                title="Low stock alerts"
                description="Notify when inventory falls below reorder level."
                checked={settings.lowStockAlerts}
                onCheckedChange={(v) => set('lowStockAlerts', v)}
              />
              <SettingRow
                title="Daily business summary"
                description="Email summary of sales, orders and expenses each morning."
                checked={settings.dailySummary}
                onCheckedChange={(v) => set('dailySummary', v)}
              />
              <SettingRow
                title="Shopify order imports"
                description="Notify on successful order imports and sync failures."
                checked={settings.orderImports}
                onCheckedChange={(v) => set('orderImports', v)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Role Permissions</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Manage role-based access to modules. Fine-grained permissions are configured per user in Users & Roles.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

type ThemeChoice = Theme | 'system'

function AppearanceCard() {
  // 'system' is stored as absence of an explicit choice; detect current effective theme.
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('opal-theme') : null
    return saved === 'dark' || saved === 'light' ? saved : 'system'
  })

  const apply = (next: ThemeChoice) => {
    setChoice(next)
    if (next === 'system') {
      window.localStorage.removeItem('opal-theme')
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
      setTheme(prefersDark ? 'dark' : 'light')
    } else {
      setTheme(next)
    }
  }

  const options: Array<{ value: ThemeChoice; label: string; icon: typeof Sun; description: string }> = [
    { value: 'light', label: 'Light', icon: Sun, description: 'Bright interface for well-lit rooms' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes in low light' },
    { value: 'system', label: 'System', icon: Monitor, description: 'Match your device setting automatically' },
  ]

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Theme</h3>
        </div>
        <p className="text-sm text-muted-foreground">Choose how Opal Line looks. This applies immediately and is remembered on this device.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((opt) => {
            const Icon = opt.icon
            const active = choice === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => apply(opt.value)}
                className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${active ? 'border-primary-500 bg-accent ring-1 ring-primary-500' : 'border-border hover:border-primary-300 hover:bg-muted/40'}`}
              >
                <div className="flex w-full items-center justify-between">
                  <Icon className={`h-5 w-5 ${active ? 'text-primary-600' : 'text-muted-foreground'}`} />
                  {active ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-primary-600">
                      <Check className="h-3.5 w-3.5" /> Active
                    </span>
                  ) : null}
                </div>
                <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.description}</span>
                {/* Mini preview strip */}
                <div className="mt-1 flex h-8 w-full overflow-hidden rounded border border-border">
                  <div className={`w-1/4 ${opt.value === 'dark' ? 'bg-[#241a35]' : 'bg-[#2e2550]'}`} />
                  <div className={`flex-1 ${opt.value === 'dark' ? 'bg-[#12151d]' : 'bg-[#f5f4fa]'}`} />
                </div>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">The 🌙 button in the header toggles between light and dark instantly; System keeps following your device.</p>
      </CardContent>
    </Card>
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

function SettingRow({ title, description, checked, onCheckedChange }: { title: string; description: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
