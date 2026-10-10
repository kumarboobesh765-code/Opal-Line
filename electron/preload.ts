import { contextBridge, ipcRenderer } from 'electron'

export interface UpdateStatusDto {
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  latest: string | null
  progress: number
  assetName: string | null
  assetSize: number | null
  filePath: string | null
  error: string | null
  /** Set when the last automatic install gave up (app still on the old version). */
  lastFailure: { at: string; reason: string } | null
}

export interface UpdatePrefsDto {
  autoDownload: boolean
  autoInstall: boolean
  showBanner: boolean
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  // Auto-update bridge — System Status page, Updates page, banner
  getUpdateStatus: (): Promise<UpdateStatusDto> => ipcRenderer.invoke('updates:status'),
  checkForUpdates: (): Promise<UpdateStatusDto> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<UpdateStatusDto> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('updates:install'),
  getUpdatePrefs: (): Promise<UpdatePrefsDto> => ipcRenderer.invoke('updates:get-prefs'),
  setUpdatePrefs: (prefs: Partial<UpdatePrefsDto>): Promise<UpdatePrefsDto> =>
    ipcRenderer.invoke('updates:set-prefs', prefs),
  clearUpdateFailure: (): Promise<UpdateStatusDto> => ipcRenderer.invoke('updates:clear-failure'),
  // Printing bridge — window.open() popups are denied by the main window's
  // window-open handler, so print flows send the built HTML here instead.
  // printHtml spools straight to the OS default printer (no dialog).
  printHtml: (html: string, title?: string, mode?: 'silent' | 'dialog'): Promise<PrintBridgeResult> =>
    ipcRenderer.invoke('print:html', html, title, mode),
  printPage: (mode?: 'silent' | 'dialog'): Promise<PrintBridgeResult> => ipcRenderer.invoke('print:page', mode),
  // "How do you want to print?" chooser — native message box with
  // Default printer / Save as PDF… / Choose printer and options… / Cancel.
  choosePrintMode: (): Promise<'silent' | 'dialog' | 'pdf' | 'cancel'> =>
    ipcRenderer.invoke('print:choose-mode'),
  previewHtml: (html: string, title?: string): Promise<PrintBridgeResult> =>
    ipcRenderer.invoke('print:preview', html, title),
  exportPdf: (html: string, suggestedName?: string): Promise<PdfBridgeResult> =>
    ipcRenderer.invoke('export:pdf', html, suggestedName),
  // Save the APP window itself as a PDF (Dashboard/DayBook/invoice-dialog
  // @media-print flows) — printToPDF + a save dialog in main.
  exportPdfPage: (suggestedName?: string): Promise<PdfBridgeResult> =>
    ipcRenderer.invoke('export:pdf-page', suggestedName),
})

export interface PrintBridgeResult {
  ok: boolean
  error?: string
}

export interface PdfBridgeResult {
  ok: boolean
  cancelled?: boolean
  path?: string
  error?: string
}
