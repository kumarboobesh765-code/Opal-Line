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
})
