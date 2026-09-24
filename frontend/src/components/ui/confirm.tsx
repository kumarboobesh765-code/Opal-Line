// Imperative toast / confirm / prompt API.
// (undo via toast.undoable below)
// Usage:
//   import { toast, confirmDialog, promptDialog } from '@/components/ui/confirm'
//   toast.success('Saved')                      // transient toast
//   toast.error('Failed to save')               // error toast, auto-dismiss
//   await confirmDialog({ title, description?, confirmLabel?, danger? })  // boolean
//   await promptDialog({ title, description?, placeholder?, defaultValue? }) // string | null
//
// Rendering lives in ./confirm-hosts (mount <ToastHost /> and <DialogHost />
// once near the app root); the hosts register themselves with the sinks below.

// ─── Toasts ──────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastAction {
  label: string
  /** Runs the action (e.g. undo). The toast stays open unless dismissAfter is set. */
  onClick: () => void
}
export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
  /** Auto-dismiss window; actions default to a longer window so undo is possible. */
  durationMs?: number
  leaving?: boolean
}

let toastSeq = 1
let pushToast: ((t: ToastItem) => void) | null = null

function emit(kind: ToastKind, message: string, action?: ToastAction, durationMs?: number) {
  const item: ToastItem = { id: toastSeq++, kind, message, action, durationMs }
  if (pushToast) pushToast(item)
}

/** Mount-side registration used by ToastHost. Returns an unregister function. */
export function registerToastSink(fn: (t: ToastItem) => void): () => void {
  pushToast = fn
  return () => {
    pushToast = null
  }
}

export const toast = {
  success: (message: string, action?: ToastAction) => emit('success', message, action),
  error: (message: string, action?: ToastAction) => emit('error', message, action),
  info: (message: string, action?: ToastAction) => emit('info', message, action),
  /** Success toast with an Undo action (10s window instead of the usual 4s). */
  undoable: (message: string, undo: () => void) =>
    emit('success', message, { label: 'Undo', onClick: undo }, 10_000),
}

// ─── Confirm / Prompt dialogs ────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  inputType?: 'text' | 'number' | 'email'
}

interface DialogStateBase {
  options: ConfirmOptions & PromptOptions
}

interface ConfirmState extends DialogStateBase {
  kind: 'confirm'
  resolve: (value: boolean) => void
}

interface PromptState extends DialogStateBase {
  kind: 'prompt'
  resolve: (value: string | null) => void
}

export type DialogState = ConfirmState | PromptState

let openDialog: ((s: DialogState) => void) | null = null

/** Mount-side registration used by DialogHost. Returns an unregister function. */
export function registerDialogSink(fn: (s: DialogState) => void): () => void {
  openDialog = fn
  return () => {
    openDialog = null
  }
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (openDialog) openDialog({ kind: 'confirm', options, resolve })
    else resolve(false)
  })
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (openDialog) openDialog({ kind: 'prompt', options, resolve })
    else resolve(null)
  })
}
