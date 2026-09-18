import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Plug, Save, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { envConfigApi } from '@/lib/api'
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
          <div className="flex items-center gap-3">
            {savedMsg && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-success-600">
                <Check className="h-4 w-4" /> {savedMsg}
              </span>
            )}
            {error && <span className="text-sm font-medium text-red-600">{error}</span>}
            <Button size="sm" onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </div>

        {dirty && !saving && (
          <p className="text-xs font-medium text-amber-600">You have unsaved changes.</p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {GROUP_ORDER.filter((g) => groups.has(g)).map((group) => (
            <div key={group} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-sm font-semibold text-foreground">{GROUP_LABELS[group] ?? group}</h4>
              </div>
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
