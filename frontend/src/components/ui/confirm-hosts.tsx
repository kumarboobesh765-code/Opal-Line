// Toast + confirm/prompt dialog hosts for the imperative API in ./confirm.
// Mount both once near the app root: <ToastHost /> <DialogHost />.

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  registerDialogSink,
  registerToastSink,
  type DialogState,
  type ToastItem,
  type ToastKind,
} from '@/components/ui/confirm'

const TOAST_STYLE: Record<ToastKind, { icon: typeof Info; border: string; iconColor: string }> = {
  success: { icon: CheckCircle2, border: 'border-l-4 border-l-green-500', iconColor: 'text-green-600 dark:text-green-400' },
  error: { icon: XCircle, border: 'border-l-4 border-l-red-500', iconColor: 'text-red-600 dark:text-red-400' },
  info: { icon: Info, border: 'border-l-4 border-l-blue-500', iconColor: 'text-blue-600' },
}

/** Renders the toast stack. Mount once near the app root. */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  // Register the global emitter for the lifetime of the host.
  useEffect(
    () =>
      registerToastSink((t) => {
        setItems((prev) => [...prev.slice(-4), t])
        const duration = t.durationMs ?? (t.kind === 'error' ? 6500 : t.action ? 8000 : 3800)
        window.setTimeout(() => {
          setItems((prev) => prev.map((p) => (p.id === t.id ? { ...p, leaving: true } : p)))
          window.setTimeout(() => {
            setItems((prev) => prev.filter((p) => p.id !== t.id))
          }, 220)
        }, duration)
      }),
    [],
  )

  const dismiss = (id: number) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, leaving: true } : p)))
    window.setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== id)), 220)
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => {
        const style = TOAST_STYLE[t.kind]
        const Icon = style.icon
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-md border bg-card p-3.5 ${t.action ? 'pr-3' : 'pr-9'} shadow-lg transition-all duration-200 ${style.border} ${t.leaving ? 'translate-x-1.5 opacity-0' : 'opacity-100'}`}
          >
            <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${style.iconColor}`} />
            <p className="min-w-0 flex-1 text-sm text-foreground">{t.message}</p>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-accent"
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className={`absolute right-2.5 top-2.5 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground ${t.action ? 'hidden' : ''}`}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Renders the confirm/prompt dialog. Mount once near the app root. */
export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null)
  const [input, setInput] = useState('')

  useEffect(
    () =>
      registerDialogSink((s) => {
        setInput(s.options.defaultValue ?? '')
        setState(s)
      }),
    [],
  )

  const close = (value: boolean | string | null) => {
    if (!state) return
    if (state.kind === 'confirm') state.resolve(Boolean(value))
    else state.resolve(typeof value === 'string' ? value : null)
    setState(null)
  }

  const handleConfirm = () => {
    if (!state) return
    close(state.kind === 'prompt' ? input.trim() : true)
  }

  const open = state !== null
  const o = state?.options
  const danger = o?.danger ?? false

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(state?.kind === 'prompt' ? null : false) }}>
      <DialogContent className="max-w-md gap-0 p-0" hideClose>
        <div className="flex items-start gap-3.5 p-5 pb-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${danger ? 'bg-red-100 dark:bg-red-950/40' : 'bg-amber-100 dark:bg-amber-950/40'}`}>
            <AlertTriangle className={`h-5 w-5 ${danger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <DialogHeader>
              <DialogTitle className="text-base leading-snug">{o?.title}</DialogTitle>
              {o?.description ? (
                <DialogDescription className="pt-1 text-sm leading-relaxed">{o.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            {state?.kind === 'prompt' ? (
              <div className="pt-3">
                <Input
                  autoFocus
                  type={o?.inputType ?? 'text'}
                  placeholder={o?.placeholder}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleConfirm()
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-3.5">
          <Button variant="outline" size="sm" onClick={() => close(state?.kind === 'prompt' ? null : false)}>
            {o?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} size="sm" onClick={handleConfirm} autoFocus>
            {o?.confirmLabel ?? (state?.kind === 'prompt' ? 'OK' : 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
