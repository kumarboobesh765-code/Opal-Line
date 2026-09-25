import { useEffect, useState } from 'react'
import { ArrowDownToLine, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UpdateStatusInfo } from '@/types'

interface UpdatePrefs {
  autoDownload: boolean
  autoInstall: boolean
  showBanner: boolean
}

interface DesktopBridge {
  getUpdateStatus?: () => Promise<UpdateStatusInfo>
  downloadUpdate?: () => Promise<UpdateStatusInfo>
  installUpdate?: () => Promise<boolean>
  getUpdatePrefs?: () => Promise<UpdatePrefs>
}

const desktop: DesktopBridge | undefined = (window as unknown as { electronAPI?: DesktopBridge }).electronAPI

/** Slim full-width banner rendered above <main> in the app shell. */
function Banner({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex min-w-0 items-center gap-3">{children}</div>
      <button
        type="button"
        aria-label="Dismiss update banner"
        className="rounded p-1 text-current/70 hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * App-wide update banner (desktop builds only). Mirrors the auto-updater
 * state the System Status page also surfaces, so users notice an update
 * without visiting that page. Browser builds render nothing.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateStatusInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showBanner, setShowBanner] = useState(true)

  useEffect(() => {
    desktop?.getUpdateStatus?.().then(setUpdate).catch(() => undefined)
    desktop?.getUpdatePrefs?.().then((p) => setShowBanner(p.showBanner)).catch(() => undefined)
  }, [])

  // While a download runs, poll the updater state so the progress bar moves.
  useEffect(() => {
    if (update?.phase !== 'downloading') return
    const t = setInterval(() => {
      desktop?.getUpdateStatus?.().then(setUpdate).catch(() => undefined)
    }, 1000)
    return () => clearInterval(t)
  }, [update?.phase])

  if (!desktop || dismissed || !showBanner || !update) return null

  if (update.phase === 'available') {
    return (
      <Banner onDismiss={() => setDismissed(true)}>
        <span className="truncate">
          Version <b>{update.latest}</b> is available — you are running {update.current}.
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              setUpdate(await desktop.downloadUpdate!())
            } catch {
              /* the System Status page surfaces update errors in detail */
            } finally {
              setBusy(false)
            }
          }}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          Download update
        </Button>
      </Banner>
    )
  }

  if (update.phase === 'downloading') {
    const pct = Math.min(100, Math.max(0, Math.round(update.progress ?? 0)))
    return (
      <Banner onDismiss={() => setDismissed(true)}>
        <span className="shrink-0">Downloading version {update.latest}…</span>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 tabular-nums">{pct}%</span>
      </Banner>
    )
  }

  if (update.phase === 'ready') {
    return (
      <Banner onDismiss={() => setDismissed(true)}>
        <span>
          Version <b>{update.latest}</b> is downloaded and verified.
        </span>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await desktop.installUpdate!().catch(() => false)
            // If the install did not trigger a restart, unblock the button.
            setBusy(false)
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Restart &amp; install
        </Button>
      </Banner>
    )
  }

  return null
}
