import { useEffect, useState, useCallback } from 'react'
import { Database, DatabaseBackup, Download, FileCheck, Loader2, Lock, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { RequireModule } from '@/components/RequirePermission'
import { backupApi, type BackupFileInfo, type BackupResult, type BackupScopeInfo, type BackupValidation, type DryRunResult } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { ActivityLogEntry } from '@/types'

export default function BackupRestorePage() {
  return (
    <RequireModule module="system">
      <BackupRestoreContent />
    </RequireModule>
  )
}

function BackupRestoreContent() {
  const [scopes, setScopes] = useState<BackupScopeInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, setPending] = useState<{ scope: BackupScopeInfo; data: Record<string, unknown[]> } | null>(null)
  const [history, setHistory] = useState<ActivityLogEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [files, setFiles] = useState<BackupFileInfo[]>([])
  const [filesLoading, setFilesLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState('')
  const [pendingFile, setPendingFile] = useState<string | null>(null)

  const [validation, setValidation] = useState<BackupValidation | null>(null)
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null)
  const [restoreOpts, setRestoreOpts] = useState<{ restoreSilverRate: boolean; skipShopify: boolean; createSafetyBackup: boolean; tables: string[] }>({ restoreSilverRate: false, skipShopify: false, createSafetyBackup: true, tables: [] })
  const [restoreTarget, setRestoreTarget] = useState<{ type: 'file'; fileName: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [notifBusy, setNotifBusy] = useState<string | null>(null)

  const reloadHistory = useCallback(() => {
    backupApi.getHistory().then(setHistory).catch(() => setHistory([])).finally(() => setHistoryLoading(false))
  }, [])

  const reloadFiles = useCallback(() => {
    backupApi.getBackupFiles().then(setFiles).catch(() => setFiles([])).finally(() => setFilesLoading(false))
  }, [])

  useEffect(() => {
    backupApi.getScopes().then(setScopes).catch(() => {})
    reloadHistory()
    reloadFiles()
  }, [reloadHistory, reloadFiles])

  const showMsg = (ok: boolean, text: string) => setMessage({ ok, text })

  const runBackup = async (scope: BackupScopeInfo, encrypted = false) => {
    const tag = encrypted ? `enc-${scope.key}` : `backup-${scope.key}`
    setBusy(tag); setMessage(null)
    try {
      const result = encrypted ? await backupApi.exportEncrypted(scope.key) : await backupApi.exportBackup(scope.key)
      const at = formatDateTime(result.exportedAt ?? new Date())
      const enc = encrypted ? ' (encrypted)' : ''
      const fileNote = result.fileName ? ` saved as ${result.fileName}.` : '.'
      showMsg(true, `${scope.label}${enc} backup exported at ${at}${fileNote}`)
      reloadHistory(); reloadFiles()
    } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Backup failed') }
    finally { setBusy(null) }
  }

  const applyRestoreResult = (result: BackupResult, label: string) => {
    const silverNote = result.silverRateIncluded ? ' Silver rate restored.' : ''
    const sync = result.shopifySync
    const syncNote = sync ? sync.ok ? ` Shopify synced (${sync.prices?.updated ?? 0} prices, ${sync.inventory?.updated ?? 0} stock).` : ` Shopify sync issue: ${sync.errors?.[0] ?? 'unknown'}.` : ''
    const safety = result.safetyBackup ? ' Safety backup created.' : ''
    showMsg(true, `${label}: restored ${result.restored ?? 0} records across ${result.tables ?? 0} tables at ${formatDateTime(result.restoredAt ?? new Date())}.${silverNote}${syncNote}${safety}`)
    reloadHistory(); reloadFiles()
  }

  const doRestore = async (fileName: string) => {
    setRestoreTarget(null); setPending(null); setPendingFile(null)
    const tag = `restore-${fileName}`
    setBusy(tag); setMessage(null)
    try {
      const result = await backupApi.restoreFile(fileName, restoreOpts)
      applyRestoreResult(result, result.label ?? 'Backup')
    } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Restore failed') }
    finally { setBusy(null) }
  }

  const startRestoreFlow = async (fileName: string) => {
    const info = files.find((f) => f.fileName === fileName)
    setRestoreOpts({ restoreSilverRate: info?.type === 'products', skipShopify: false, createSafetyBackup: true, tables: [] })
    setBusy('validate-' + fileName); setMessage(null)
    try {
      const v = await backupApi.validate(fileName)
      setValidation(v)
      if (!v.valid) { showMsg(false, `Validation failed: ${v.errors?.join(', ')}`); return }
      setBusy('dryrun-' + fileName)
      const dr = await backupApi.dryRun(fileName, {})
      setDryRunResult(dr)
      setRestoreTarget({ type: 'file', fileName })
    } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Validation failed') }
    finally { setBusy(null) }
  }

  const confirmRestore = () => {
    if (!restoreTarget) return
    doRestore(restoreTarget.fileName)
  }

  const deleteFile = async (fileName: string) => {
    setDeleting(fileName); setMessage(null)
    try {
      await backupApi.deleteFile(fileName)
      showMsg(true, `Deleted ${fileName}`)
      if (selectedFile === fileName) setSelectedFile('')
      reloadFiles()
    } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Delete failed') }
    finally { setDeleting(null) }
  }

  const doCleanup = async () => {
    setCleanupBusy(true); setMessage(null)
    try {
      const result = await backupApi.cleanup(10)
      showMsg(true, `Cleanup done: deleted ${result.deleted.length} backup(s), kept ${result.kept}.`)
      reloadFiles()
    } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Cleanup failed') }
    finally { setCleanupBusy(false) }
  }

  const ordered = ['products', 'customers', 'orders', 'inventory', 'sales-reports', 'gst-reports', 'dashboard', 'full']
  const visible = ordered.map((key) => scopes.find((s) => s.key === key)).filter((s): s is BackupScopeInfo => Boolean(s)).concat(scopes.filter((s) => !ordered.includes(s.key)))

  const restoreDialogOpen = restoreTarget !== null

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-4 sm:py-6 lg:px-6">
      <PageHeader
        title="Backup & Restore"
        subtitle="Export, validate, and restore data backups."
      />

      {message && (
        <div className={`rounded-lg border p-3 text-sm font-medium ${message.ok ? 'border-success-200 bg-success-50 text-success-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <Card>
        <CardContent className="space-y-1 p-5">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Backup & Restore</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Export data backups (plain or encrypted) stored on the server, validate and dry-run before restoring, or restore from a previously saved backup. Restoring replaces matching records; records not present in the backup are untouched.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((scope) => (
          <ScopeCard
            key={scope.key}
            scope={scope}
            busy={busy}
            disabled={busy !== null}
            onBackup={() => runBackup(scope)}
            onEncryptedBackup={() => runBackup(scope, true)}
            onFile={(file) => {
              const reader = new FileReader()
              reader.onload = async () => {
                try {
                  const data = JSON.parse(reader.result as string)
                  if (scope.key === 'products' && data.silver_rates) { setPending({ scope, data }) }
                  else {
                    setRestoreOpts({ restoreSilverRate: false, skipShopify: false, createSafetyBackup: true, tables: [] })
                    setValidation(null); setDryRunResult(null)
                    setRestoreTarget({ type: 'file', fileName: '' })
                    setRestoreOpts((o) => ({ ...o }))
                  }
                } catch { showMsg(false, 'Invalid JSON file') }
              }
              reader.readAsText(file)
            }}
          />
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DatabaseBackup className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Backup History</h3>
            </div>
            <Button variant="outline" size="sm" onClick={reloadHistory} disabled={historyLoading}>
              {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
          {historyLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</div>
          ) : history.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No backup or restore operations recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border">
              {history.slice(0, 20).map((h) => {
                const isBackup = h.action === 'Exported Backup'
                const detailParts = h.details?.split(' · ') ?? []
                const histFileName = detailParts.length >= 3 ? detailParts[detailParts.length - 1] : null
                return (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <Badge variant={h.action === 'Restored Backup' ? 'warning' : 'success'}>
                      {h.action === 'Restored Backup' ? 'Restored' : h.action === 'Compared Backups' ? 'Diff' : 'Backup'}
                    </Badge>
                    <span className="whitespace-nowrap font-mono text-[12px] text-foreground">{h.entity}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{h.details}</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{h.user}</span>
                    <span className="whitespace-nowrap text-xs font-medium text-foreground">{formatDateTime(h.timestamp)}</span>
                    {isBackup && histFileName && (
                      <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" disabled={busy !== null} onClick={() => startRestoreFlow(histFileName)}>
                        {busy?.includes(histFileName) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        Restore
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Server Backups</h3>
            </div>
            <Button variant="outline" size="sm" onClick={reloadFiles} disabled={filesLoading}>
              {filesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Stored backups including daily auto-backups. Select a file to validate, dry-run, restore, or download.
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={doCleanup} disabled={cleanupBusy || busy !== null} className="text-xs">
              {cleanupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Cleanup Old Backups
            </Button>
          </div>
          {filesLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : files.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No backups stored on the server yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
                <Select
                  options={files.map((f) => ({ value: f.fileName, label: `${f.isEncrypted ? '🔒 ' : ''}${f.label ?? f.type ?? 'Backup'} · ${f.exportedAt ? formatDateTime(f.exportedAt) : f.fileName} · ${f.fileSize ? `${(f.fileSize / 1024).toFixed(1)} KB` : ''}` }))}
                  value={selectedFile}
                  onValueChange={setSelectedFile}
                  placeholder="Select a backup…"
                  className="min-w-[320px] flex-1"
                />
                <Button size="sm" onClick={() => selectedFile && startRestoreFlow(selectedFile)} disabled={!selectedFile || busy !== null}>
                  {busy?.startsWith('restore-') || busy?.startsWith('validate-') || busy?.startsWith('dryrun-') ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Validate & Restore
                </Button>
                <Button size="sm" variant="outline" onClick={() => selectedFile && backupApi.downloadFile(selectedFile)} disabled={!selectedFile}>
                  <Download className="h-4 w-4" />
                  Download
                </Button>
                <Button size="sm" variant="outline" onClick={() => selectedFile && deleteFile(selectedFile)} disabled={!selectedFile || deleting !== null || busy !== null} className="text-red-600 hover:text-red-700">
                  {deleting === selectedFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </Button>
              </div>
              <div className="max-h-[240px] overflow-y-auto rounded-lg border divide-y divide-border">
                {files.map((f) => (
                  <div key={f.fileName} className={`flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-muted/50 ${selectedFile === f.fileName ? 'bg-primary-50' : ''}`} onClick={() => setSelectedFile(f.fileName)}>
                    {f.isEncrypted ? <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">{f.label ?? f.type ?? 'Backup'}</div>
                      <div className="text-xs text-muted-foreground truncate">{f.fileName}</div>
                    </div>
                    <Badge variant={f.isPreRestore ? 'warning' : f.isEncrypted ? 'info' : 'muted'}>{f.isPreRestore ? 'Pre-restore' : f.isEncrypted ? 'Encrypted' : f.type}</Badge>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{f.exportedAt ? formatDateTime(f.exportedAt) : '—'}</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{f.fileSize ? `${(f.fileSize / 1024).toFixed(1)} KB` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Email Notifications</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure email alerts for backups, low stock, and daily summaries. Requires <code className="rounded bg-muted px-1.5 py-0.5 text-xs">RESEND_API_KEY</code> and <code className="rounded bg-muted px-1.5 py-0.5 text-xs">NOTIFICATION_EMAIL</code> in .env.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={notifBusy !== null} onClick={async () => {
              setNotifBusy('test'); setMessage(null)
              try {
                const r = await backupApi.testNotification()
                showMsg(r.ok, r.ok ? `Test email sent to ${r.email}` : 'Failed to send — check RESEND_API_KEY')
              } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Failed') }
              finally { setNotifBusy(null) }
            }}>
              {notifBusy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Send Test Email
            </Button>
            <Button size="sm" variant="outline" disabled={notifBusy !== null} onClick={async () => {
              setNotifBusy('lowstock'); setMessage(null)
              try {
                const r = await backupApi.sendLowStockAlert()
                showMsg(r.ok, r.ok ? `Low stock alert sent (${r.count} items)` : 'Failed to send')
              } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Failed') }
              finally { setNotifBusy(null) }
            }}>
              {notifBusy === 'lowstock' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Low Stock Alert
            </Button>
            <Button size="sm" variant="outline" disabled={notifBusy !== null} onClick={async () => {
              setNotifBusy('summary'); setMessage(null)
              try {
                const r = await backupApi.sendDailySummary()
                showMsg(r.ok, r.ok ? 'Daily summary sent' : 'Failed to send')
              } catch (e) { showMsg(false, e instanceof Error ? e.message : 'Failed') }
              finally { setNotifBusy(null) }
            }}>
              {notifBusy === 'summary' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Daily Summary
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={pending !== null || pendingFile !== null} onOpenChange={(open) => { if (!open) { setPending(null); setPendingFile(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore silver rate too?</DialogTitle>
            <DialogDescription>This product backup contains a silver rate snapshot. Restore it alongside the products?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => { setPending(null); setPendingFile(null) }}>Cancel</Button>
            <Button variant="outline" onClick={() => {
              if (pending) { setRestoreOpts({ restoreSilverRate: false, skipShopify: false, createSafetyBackup: true, tables: [] }); setRestoreTarget({ type: 'file', fileName: '' }) }
              if (pendingFile) startRestoreFlow(pendingFile)
              setPending(null); setPendingFile(null)
            }}>Products only</Button>
            <Button onClick={() => {
              if (pending) { setRestoreOpts({ restoreSilverRate: true, skipShopify: false, createSafetyBackup: true, tables: [] }); setRestoreTarget({ type: 'file', fileName: '' }) }
              if (pendingFile) { setRestoreOpts((o) => ({ ...o, restoreSilverRate: true })); startRestoreFlow(pendingFile) }
              setPending(null); setPendingFile(null)
            }}>Products + Silver Rate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreDialogOpen} onOpenChange={(open) => { if (!open) setRestoreTarget(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Restore Preview</DialogTitle>
            <DialogDescription>Review what will happen before restoring {restoreTarget?.fileName}</DialogDescription>
          </DialogHeader>
          {validation && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-success-600" />
                <span className="font-medium">Validation: {validation.valid ? 'Passed' : 'Failed'}</span>
              </div>
              {validation.warnings?.length ? (
                <ul className="list-disc pl-5 text-muted-foreground">{validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              ) : null}
              {validation.meta && (
                <div className="text-xs text-muted-foreground">Tables: {validation.tables?.length ?? 0} · Records: {validation.totalRecords ?? 0} · Size: {validation.fileSize ? `${(validation.fileSize / 1024).toFixed(1)} KB` : '—'}</div>
              )}
            </div>
          )}
          {dryRunResult && (
            <div className="space-y-2 text-sm">
              <div className="font-medium">Dry-run preview:</div>
              <div className="max-h-[200px] overflow-y-auto rounded-lg border divide-y divide-border">
                {dryRunResult.tables.map((t) => (
                  <div key={t.name} className="flex items-center gap-3 px-3 py-2">
                    <span className="font-mono text-xs font-medium w-[160px] truncate">{t.name}</span>
                    <Badge variant="success" className="text-[10px]">+{t.willInsert}</Badge>
                    <Badge variant="danger" className="text-[10px]">-{t.willDelete}</Badge>
                    <Badge variant="muted" className="text-[10px]">={t.currentRecords} current</Badge>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">Total: +{dryRunResult.totalWillInsert} inserts, -{dryRunResult.totalWillDelete} deletes across {dryRunResult.tables.length} tables</div>
            </div>
          )}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><div className="text-sm font-medium">Restore silver rate</div><div className="text-xs text-muted-foreground">Revert silver rate to backup snapshot</div></div>
              <Switch checked={restoreOpts.restoreSilverRate} onCheckedChange={(v) => setRestoreOpts((o) => ({ ...o, restoreSilverRate: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><div className="text-sm font-medium">Create safety backup first</div><div className="text-xs text-muted-foreground">Auto-backup current data before restoring</div></div>
              <Switch checked={restoreOpts.createSafetyBackup} onCheckedChange={(v) => setRestoreOpts((o) => ({ ...o, createSafetyBackup: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><div className="text-sm font-medium">Skip Shopify sync</div><div className="text-xs text-muted-foreground">Don't push restored data to Shopify</div></div>
              <Switch checked={restoreOpts.skipShopify} onCheckedChange={(v) => setRestoreOpts((o) => ({ ...o, skipShopify: v }))} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button onClick={confirmRestore} disabled={busy !== null}>
              {busy?.startsWith('restore-') ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Confirm Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ScopeCard({ scope, busy, disabled, onBackup, onEncryptedBackup, onFile }: {
  scope: BackupScopeInfo
  busy: string | null
  disabled: boolean
  onBackup: () => void
  onEncryptedBackup: () => void
  onFile: (file: File) => void
}) {
  const inputId = `restore-${scope.key}`
  const exporting = busy === `backup-${scope.key}`
  const exportingEnc = busy === `enc-${scope.key}`
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">{scope.label}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{scope.description}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onBackup} disabled={disabled}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Saving...' : 'Backup'}
          </Button>
          <Button size="sm" variant="outline" onClick={onEncryptedBackup} disabled={disabled}>
            {exportingEnc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {exportingEnc ? 'Saving...' : 'Encrypted'}
          </Button>
          <label htmlFor={inputId}>
            <Button asChild variant="outline" size="sm" disabled={disabled}>
              <span className="flex items-center gap-1.5">
                <Upload className="h-4 w-4" /> Restore
              </span>
            </Button>
          </label>
          <input id={inputId} type="file" accept=".json,application/json" className="hidden" disabled={disabled} onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = '' }} />
        </div>
      </CardContent>
    </Card>
  )
}
