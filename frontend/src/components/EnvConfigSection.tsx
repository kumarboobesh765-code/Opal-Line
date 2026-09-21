import { useCallback, useEffect, useState } from 'react'
import { Check, ListChecks, Loader2, Plug, Save, SlidersHorizontal, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { envConfigApi, shopifyApi } from '@/lib/api'
import type { EnvConfigDef, EnvConfigData } from '@/types'

const GROUP_LABELS: Record<string, string> = {
  shopify: 'Shopify & Webhooks',
  email: 'Order Email Ingest',
  notifications: 'Email Notifications',
  payments: 'Razorpay Payments',
  whatsapp: 'WhatsApp',
  backup: 'Off-Site Backup (S3/R2/B2)',
  server: 'Server',
}

const GROUP_ORDER = ['shopify', 'email', 'notifications', 'payments', 'whatsapp', 'backup', 'server'] as const

type GroupTestResult = { ok: boolean; text: string }

/** One live test per configuration group — uses the saved (server) values. */
const GROUP_TESTS: Partial<Record<string, () => Promise<GroupTestResult>>> = {
  shopify: async () => {
    const r = await shopifyApi.testConnection()
    return r.ok
      ? { ok: true, text: r.shop ? `Connected to ${r.shop}` : 'Shopify credentials valid' }
      : { ok: false, text: r.error ?? 'Connection failed' }
  },
  email: async () => {
    const r = await shopifyApi.testMailbox()
    if (!r.ok) return { ok: false, text: r.error ?? 'Mailbox login failed' }
    const bits = [r.provider === 'mailtm' ? 'mail.tm' : `IMAP ${r.host ?? ''}`, r.folder, r.messageCount != null ? `${r.messageCount} message(s)` : null].filter(Boolean)
    return { ok: true, text: `Mailbox login OK — ${bits.join(' · ')}` }
  },
  notifications: async () => {
    const r = await shopifyApi.testEmail()
    return r.ok
      ? { ok: true, text: `Test email sent to ${r.to}` }
      : { ok: false, text: r.error ?? 'Send failed' }
  },
  payments: async () => {
    const r = await shopifyApi.testRazorpay()
    return r.ok
      ? { ok: true, text: r.message ?? 'Credentials valid' }
      : { ok: false, text: r.error ?? 'Test failed' }
  },
  whatsapp: async () => {
    const r = await shopifyApi.testWhatsAppConfig()
    return r.ok
      ? { ok: true, text: r.message ?? 'Token valid' }
      : { ok: false, text: r.error ?? 'Test failed' }
  },
  backup: async () => {
    const r = await shopifyApi.testOffsiteBackup()
    return r.ok
      ? { ok: true, text: r.bucket ? `Bucket reachable: ${r.bucket}` : 'Bucket reachable' }
      : { ok: false, text: r.error ?? 'Connection failed' }
  },
}

/**
 * "Configuration" panel — every env-backed setting editable from the UI.
 * Secrets show masked and are re-encrypted server-side on save; submitting
 * the mask back is a no-op so the whole form can be saved at once.
 */
export function EnvConfigSection() {
  const [data, setData] = useState<EnvConfigData | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [testingGroup, setTestingGroup] = useState<string | null>(null)
  const [groupResults, setGroupResults] = useState<Record<string, GroupTestResult>>({})
  const [testingAll, setTestingAll] = useState(false)
  const [allSummary, setAllSummary] = useState<{ passed: number; failed: number } | null>(null)
  const [lastTestedAt, setLastTestedAt] = useState<Record<string, string>>({})

  const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  /** Run every group test in order, showing each result as it lands. */
  const runAllTests = async () => {
    if (testingAll || testingGroup) return
    setTestingAll(true)
    setAllSummary(null)
    setGroupResults({})
    let passed = 0
    let failed = 0
    for (const group of GROUP_ORDER) {
      const fn = GROUP_TESTS[group]
      if (!fn) continue
      setTestingGroup(group)
      try {
        const result = await fn()
        setGroupResults((prev) => ({ ...prev, [group]: result }))
        setLastTestedAt((prev) => ({ ...prev, [group]: stamp() }))
        if (result.ok) passed++
        else failed++
      } catch (e) {
        setGroupResults((prev) => ({ ...prev, [group]: { ok: false, text: e instanceof Error ? e.message : 'Test failed' } }))
        setLastTestedAt((prev) => ({ ...prev, [group]: stamp() }))
        failed++
      }
    }
    setTestingGroup(null)
    setTestingAll(false)
    setAllSummary({ passed, failed })
  }

  const runGroupTest = async (group: string) => {
    const fn = GROUP_TESTS[group]
    if (!fn || testingGroup) return
    setTestingGroup(group)
    setGroupResults((prev) => {
      const next = { ...prev }
      delete next[group]
      return next
    })
    try {
      const result = await fn()
      setGroupResults((prev) => ({ ...prev, [group]: result }))
      setLastTestedAt((prev) => ({ ...prev, [group]: stamp() }))
    } catch (e) {
      setGroupResults((prev) => ({ ...prev, [group]: { ok: false, text: e instanceof Error ? e.message : 'Test failed' } }))
      setLastTestedAt((prev) => ({ ...prev, [group]: stamp() }))
    } finally {
      setTestingGroup(null)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    envConfigApi.get().then((d) => {
      setData(d)
      setValues({ ...d.values })
      setLoading(false)
    }).catch(() => {
      setError('Failed to load configuration')
      setLoading(false)
    })
  }, [])

  useEffect(load, [load])

  const save = async () => {
    setSaving(true)
    setError('')
    setSavedMsg(null)
    try {
      const r = await envConfigApi.update(values)
      setSavedMsg(`Saved ${r.updated.length} setting(s)${r.skipped.length ? ` · ${r.skipped.length} unchanged` : ''}`)
      // Reload so masked secrets re-mask and any new values appear
      load()
      setTimeout(() => setSavedMsg(null), 5000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  const dirty = data ? Object.entries(values).some(([k, v]) => v !== data.values[k]) : false

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading configuration...
        </CardContent>
      </Card>
    )
  }

  const groups = new Map<string, EnvConfigDef[]>()
  for (const def of data?.defs ?? []) {
    if (!groups.has(def.group)) groups.set(def.group, [])
    groups.get(def.group)!.push(def)
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-foreground">Configuration</h3>
              <p className="text-xs text-muted-foreground">
                Every deployment setting, editable here — values are saved to the server .env (secrets encrypted). No backend access needed.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {savedMsg && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-success-600">
                <Check className="h-4 w-4" /> {savedMsg}
              </span>
            )}
            {error && <span className="text-sm font-medium text-red-600 dark:text-red-400">{error}</span>}
            {allSummary && (
              <span className={`flex items-center gap-1.5 text-sm font-medium ${allSummary.failed === 0 ? 'text-success-600' : 'text-amber-600 dark:text-amber-400'}`}>
                {allSummary.failed === 0 ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {allSummary.passed} passed{allSummary.failed > 0 ? ` · ${allSummary.failed} failed / not configured` : ' · all good'}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={runAllTests} disabled={saving || loading || testingAll || testingGroup !== null}>
              {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              {testingAll ? 'Testing all...' : 'Test All'}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </div>

        {dirty && !saving && (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">You have unsaved changes — tests use the last saved values, so save first.</p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {GROUP_ORDER.filter((g) => groups.has(g)).map((group) => (
            <div key={group} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  <h4 className="text-sm font-semibold text-foreground">{GROUP_LABELS[group] ?? group}</h4>
                </div>
                {GROUP_TESTS[group] ? (
                  <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => runGroupTest(group)} disabled={testingGroup !== null || testingAll}>
                    {testingGroup === group ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {testingGroup === group ? 'Testing...' : 'Test'}
                  </Button>
                ) : null}
              </div>
              {groupResults[group] && (
                <p className={`mb-3 text-xs font-medium ${groupResults[group].ok ? 'text-success-600' : 'text-red-600 dark:text-red-400'}`}>
                  {groupResults[group].text}
                  <span className="ml-1.5 font-normal text-muted-foreground">· tested {lastTestedAt[group]}</span>
                </p>
              )}
              <div className="space-y-3">
                {groups.get(group)!.map((def) => (
                  <EnvField
                    key={def.key}
                    def={def}
                    value={values[def.key] ?? ''}
                    configured={data?.configured?.[def.key] ?? false}
                    onChange={(v) => setValues((prev) => ({ ...prev, [def.key]: v }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Some values (like the database URL) need a backend restart to take effect — everything else applies immediately.
        </p>
      </CardContent>
    </Card>
  )
}

function EnvField({ def, value, configured, onChange }: { def: EnvConfigDef; value: string; configured: boolean; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{def.label}</Label>
        {configured ? (
          <Badge variant="success" className="text-[9px]">set</Badge>
        ) : (
          <Badge variant="muted" className="text-[9px]">not set</Badge>
        )}
      </div>
      <div className="relative">
        <Input
          type={def.secret && !show ? 'password' : 'text'}
          placeholder={def.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-16 font-mono text-xs"
        />
        {def.secret && value && (
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {show ? 'hide' : 'show'}
          </button>
        )}
      </div>
      {def.hint && <p className="text-[10px] text-muted-foreground">{def.hint}</p>}
    </div>
  )
}
