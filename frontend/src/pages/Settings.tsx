import { useEffect, useState, useCallback } from 'react'
import { Bell, Building2, Check, Database, Eye, EyeOff, Landmark, Loader2, Mail, Plug, Save, Settings as SettingsIcon, SlidersHorizontal, Tag, Users, Wifi, WifiOff } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RequireModule } from '@/components/RequirePermission'
import { backupApi, dbApi, shopifyApi } from '@/lib/api'
import type { AppSettings, ConnectionSettings, DbStatus } from '@/types'

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

const DEFAULT_CONNECTIONS: ConnectionSettings = {
  shopifyStoreUrl: '',
  shopifyAccessToken: '',
  shopifyApiVersion: '2025-10',
  webhookSecret: '',
  shopifyConfigured: false,
  dbHost: 'localhost',
  dbPort: '5432',
  dbDatabase: 'opal_line',
  dbUser: 'postgres',
  dbPassword: '',
  dbConfigured: false,
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
      setError(e instanceof Error ? e.message : 'Failed to save settings')
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
            {status === 'error' ? <span className="text-sm font-medium text-red-600">{error}</span> : null}
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
          <TabsTrigger value="silver"><Tag /> Silver Rate</TabsTrigger>
          <TabsTrigger value="banking"><Landmark /> Banking</TabsTrigger>
          <TabsTrigger value="notifications"><Bell /> Notifications</TabsTrigger>
          <TabsTrigger value="connections"><Plug /> Connections</TabsTrigger>
          <TabsTrigger value="team"><Users /> Team</TabsTrigger>
        </TabsList>

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

        <TabsContent value="connections">
          <ConnectionsTab />
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

function ConnectionsTab() {
  const [conn, setConn] = useState<ConnectionSettings>(DEFAULT_CONNECTIONS)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [showWebhook, setShowWebhook] = useState(false)
  const [showDbPassword, setShowDbPassword] = useState(false)
  const [testingShopify, setTestingShopify] = useState(false)
  const [shopifyTestResult, setShopifyTestResult] = useState<'ok' | 'fail' | null>(null)
  const [shopifyTestMsg, setShopifyTestMsg] = useState('')
  const [ingest, setIngest] = useState<{ configured: boolean; mailbox: string | null; host: string } | null>(null)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)
  const [emailTest, setEmailTest] = useState<{ ok: boolean; to?: string; error?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      dbApi.getConnectionSettings(),
      dbApi.getDbStatus(),
      backupApi.emailIngestStatus(),
    ]).then(([connResult, dbResult, ingestResult]) => {
      if (cancelled) return
      if (connResult.status === 'fulfilled') {
        setConn((c) => ({ ...c, ...connResult.value }))
      }
      if (dbResult.status === 'fulfilled') {
        setDbStatus(dbResult.value)
      } else {
        setDbStatus({ connected: false, error: 'Failed to fetch status' })
      }
      if (ingestResult.status === 'fulfilled') setIngest(ingestResult.value)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  const testShopify = useCallback(async () => {
    setTestingShopify(true)
    setShopifyTestResult(null)
    setShopifyTestMsg('')
    try {
      const isMasked = (v: string) => /^[•*]+$/.test(v)
      const creds: { shopifyStoreUrl?: string; shopifyAccessToken?: string } = {}
      if (conn.shopifyStoreUrl && !isMasked(conn.shopifyStoreUrl)) creds.shopifyStoreUrl = conn.shopifyStoreUrl
      if (conn.shopifyAccessToken && !isMasked(conn.shopifyAccessToken)) creds.shopifyAccessToken = conn.shopifyAccessToken
      const body = Object.keys(creds).length > 0 ? creds : undefined
      const res = await shopifyApi.testConnection(body)
      setShopifyTestResult(res.ok ? 'ok' : 'fail')
      setShopifyTestMsg(res.ok ? (res.shop ? `Connected to ${res.shop}` : 'Connected successfully') : (res.error || 'Connection failed'))
    } catch {
      setShopifyTestResult('fail')
      setShopifyTestMsg('Connection failed')
    } finally {
      setTestingShopify(false)
    }
  }, [conn.shopifyStoreUrl, conn.shopifyAccessToken])

  const saveConnections = async () => {
    setSaving(true)
    setStatus('idle')
    setError('')
    try {
      const patch: Record<string, string> = {}
      const isMasked = (v: string) => /^[•*]+$/.test(v)
      if (conn.shopifyStoreUrl && !isMasked(conn.shopifyStoreUrl)) patch.shopifyStoreUrl = conn.shopifyStoreUrl
      if (conn.shopifyAccessToken && !isMasked(conn.shopifyAccessToken)) patch.shopifyAccessToken = conn.shopifyAccessToken
      if (conn.shopifyApiVersion) patch.shopifyApiVersion = conn.shopifyApiVersion
      if (conn.webhookSecret && !isMasked(conn.webhookSecret)) patch.webhookSecret = conn.webhookSecret
      if (conn.dbHost && !isMasked(conn.dbHost)) patch.dbHost = conn.dbHost
      if (conn.dbPort && !isMasked(conn.dbPort)) patch.dbPort = conn.dbPort
      if (conn.dbDatabase && !isMasked(conn.dbDatabase)) patch.dbDatabase = conn.dbDatabase
      if (conn.dbUser && !isMasked(conn.dbUser)) patch.dbUser = conn.dbUser
      if (conn.dbPassword && !isMasked(conn.dbPassword)) patch.dbPassword = conn.dbPassword
      const res = await dbApi.updateConnectionSettings(patch)
      setStatus('saved')
      setConn((c) => ({
        ...c,
        shopifyConfigured: Boolean(conn.shopifyStoreUrl && conn.shopifyAccessToken),
        dbConfigured: Boolean(conn.dbHost && conn.dbUser && conn.dbPassword),
      }))
      if (res.shopify) {
        if (res.shopify.ok) {
          setShopifyTestResult('ok')
          if (!res.reconnectError) setError('')
        } else {
          setShopifyTestResult('fail')
          setError(res.shopify.error || 'Shopify connection failed')
          setStatus('error')
        }
      }
      // Refresh DB status after save (may have reconnected)
      if (patch.dbHost || patch.dbPassword || patch.dbUser) {
        setTimeout(async () => {
          try {
            const newStatus = await dbApi.getDbStatus()
            setDbStatus(newStatus)
          } catch { /* ignore */ }
        }, 1500)
      }
      if ((res as any).reconnectError) {
        setError(`DB saved but reconnect failed: ${(res as any).reconnectError}`)
        setStatus('error')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const testDbConnection = useCallback(async () => {
    try {
      const status = await dbApi.getDbStatus()
      setDbStatus(status)
    } catch {
      setDbStatus({ connected: false, error: 'Health check failed' })
    }
  }, [])

  const runEmailTest = async () => {
    setTestingEmail(true)
    setEmailTest(null)
    try {
      const res = await shopifyApi.testEmail(testEmailTo.trim() || undefined)
      setEmailTest(res)
    } catch (e) {
      setEmailTest({ ok: false, error: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setTestingEmail(false)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Shopify Configuration</h3>
            </div>
            {conn.shopifyConfigured ? (
              <span className="flex items-center gap-1 text-xs font-medium text-green-600"><Wifi className="h-3 w-3" /> Connected</span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><WifiOff className="h-3 w-3" /> Not connected</span>
            )}
          </div>

          <Field label="Store URL (subdomain)">
            <Input
              placeholder="e.g. testing-nnwap2fl"
              value={conn.shopifyStoreUrl}
              onChange={(e) => setConn((c) => ({ ...c, shopifyStoreUrl: e.target.value }))}
            />
          </Field>

          <Field label="Access Token">
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder="shpat_xxxxxxxxxxxxxxxx"
                value={conn.shopifyAccessToken}
                onChange={(e) => setConn((c) => ({ ...c, shopifyAccessToken: e.target.value }))}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <Field label="API Version">
            <Input
              value={conn.shopifyApiVersion}
              onChange={(e) => setConn((c) => ({ ...c, shopifyApiVersion: e.target.value }))}
            />
          </Field>

          <Field label="Webhook Secret (optional)">
            <div className="relative">
              <Input
                type={showWebhook ? 'text' : 'password'}
                placeholder="Your Shopify webhook HMAC secret"
                value={conn.webhookSecret}
                onChange={(e) => setConn((c) => ({ ...c, webhookSecret: e.target.value }))}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowWebhook(!showWebhook)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={testShopify} disabled={testingShopify || !loaded}>
              {testingShopify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              {testingShopify ? 'Testing...' : 'Test Connection'}
            </Button>
            {shopifyTestResult === 'ok' && <span className="text-xs font-medium text-green-600">{shopifyTestMsg || 'Connected successfully'}</span>}
            {shopifyTestResult === 'fail' && <span className="text-xs font-medium text-red-600 max-w-[28rem]">{shopifyTestMsg || 'Connection failed'}</span>}
          </div>

          <p className="text-xs text-muted-foreground">
            Secrets are encrypted with AES-256-GCM and stored securely in the database.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Database Connection</h3>
            </div>
            {dbStatus ? (
              dbStatus.connected ? (
                <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                  <Wifi className="h-3 w-3" /> Connected
                  {dbStatus.latencyMs != null && <span className="text-muted-foreground ml-1">{dbStatus.latencyMs}ms</span>}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-red-600"><WifiOff className="h-3 w-3" /> Disconnected</span>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking...</span>
            )}
          </div>

          <Field label="Host">
            <Input
              placeholder="localhost"
              value={conn.dbHost}
              onChange={(e) => setConn((c) => ({ ...c, dbHost: e.target.value }))}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Port">
              <Input
                placeholder="5432"
                value={conn.dbPort}
                onChange={(e) => setConn((c) => ({ ...c, dbPort: e.target.value }))}
              />
            </Field>
            <Field label="Database">
              <Input
                placeholder="opal_line"
                value={conn.dbDatabase}
                onChange={(e) => setConn((c) => ({ ...c, dbDatabase: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="User">
            <Input
              placeholder="postgres"
              value={conn.dbUser}
              onChange={(e) => setConn((c) => ({ ...c, dbUser: e.target.value }))}
            />
          </Field>

          <Field label="Password">
            <div className="relative">
              <Input
                type={showDbPassword ? 'text' : 'password'}
                placeholder="Enter database password"
                value={conn.dbPassword}
                onChange={(e) => setConn((c) => ({ ...c, dbPassword: e.target.value }))}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowDbPassword(!showDbPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showDbPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>

          {dbStatus?.error && (
            <p className="text-xs text-red-500">{dbStatus.error}</p>
          )}

          {dbStatus?.connected && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Host</Label>
                <p className="font-mono text-foreground">{dbStatus.host || '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Port</Label>
                <p className="font-mono text-foreground">{dbStatus.port || '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Database</Label>
                <p className="font-mono text-foreground">{dbStatus.database || '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">User</Label>
                <p className="font-mono text-foreground">{dbStatus.user || '—'}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={testDbConnection} disabled={!loaded}>
              <Database className="h-4 w-4" />
              Test Connection
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Database credentials are encrypted and stored securely. Saving new credentials will reconnect the server.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Email / Order Ingest</h3>
            </div>
            {ingest ? (
              ingest.configured ? (
                <span className="flex items-center gap-1 text-xs font-medium text-green-600"><Wifi className="h-3 w-3" /> Mailbox ready</span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><WifiOff className="h-3 w-3" /> Not configured</span>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking...</span>
            )}
          </div>

          {ingest?.configured && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Mailbox</Label>
                <p className="font-mono text-foreground">{ingest.mailbox ?? '—'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">IMAP Host</Label>
                <p className="font-mono text-foreground">{ingest.host}</p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Shopify "New order" notification emails are read from the mailbox via IMAP and converted into orders.
            Outgoing alerts use RESEND_API_KEY or Gmail SMTP (NOTIFICATION_SMTP_* vars).
          </p>

          <div className="space-y-2 pt-1">
            <Field label="Send test email to">
              <Input
                type="email"
                placeholder="owner@example.com (blank = NOTIFICATION_EMAIL)"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={runEmailTest} disabled={testingEmail}>
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {testingEmail ? 'Sending...' : 'Send Test Email'}
              </Button>
              {emailTest && (
                emailTest.ok
                  ? <span className="text-xs font-medium text-green-600">Sent to {emailTest.to}</span>
                  : <span className="text-xs font-medium text-red-600 max-w-[22rem]">{emailTest.error}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="lg:col-span-2 flex items-center justify-end gap-3">
        {status === 'saved' && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-success-600">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        {status === 'error' && <span className="text-sm font-medium text-red-600">{error}</span>}
        <Button size="sm" onClick={saveConnections} disabled={saving || !loaded}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : 'Save Connections'}
        </Button>
      </div>
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
