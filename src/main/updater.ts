import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  releaseNotes?: string
  releaseUrl?: string
  progress?: {
    percent: number
    transferred: number
    total: number
    bytesPerSecond: number
  }
  error?: string
}

const RELEASES_URL = 'https://github.com/coolbirdzik/auto-register-all/releases'

let currentState: UpdateState = {
  status: 'idle',
  currentVersion: ''
}

let listeners = new Set<(state: UpdateState) => void>()
let initialized = false

function emit(): void {
  for (const listener of listeners) {
    try {
      listener(currentState)
    } catch (err) {
      console.error('[updater] listener error', err)
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('update-state', currentState)
    }
  }
}

function setState(patch: Partial<UpdateState>): void {
  currentState = { ...currentState, ...patch }
  emit()
}

export function getUpdateState(): UpdateState {
  return currentState
}

export function onUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function initUpdater(): void {
  if (initialized) return
  initialized = true

  currentState = {
    status: 'idle',
    currentVersion: app.getVersion()
  }

  // We drive updates manually, so disable any built-in automatic behavior.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

  // Pipe electron-updater logs into stdout for easier debugging in production.
  autoUpdater.logger = {
    info: (...args: unknown[]) => console.log('[updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[updater]', ...args),
    error: (...args: unknown[]) => console.error('[updater]', ...args),
    debug: (...args: unknown[]) => console.log('[updater:debug]', ...args)
  } as unknown as typeof autoUpdater.logger

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({
      status: 'available',
      latestVersion: info.version,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseUrl: RELEASES_URL,
      error: undefined
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setState({
      status: 'not-available',
      latestVersion: info.version,
      releaseUrl: RELEASES_URL,
      error: undefined
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState({
      status: 'downloading',
      progress: {
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      }
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({
      status: 'downloaded',
      latestVersion: info.version,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
      releaseUrl: RELEASES_URL,
      progress: {
        percent: 100,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0
      },
      error: undefined
    })
  })

  autoUpdater.on('error', (err: Error) => {
    setState({
      status: 'error',
      error: err?.message || String(err),
      releaseUrl: RELEASES_URL
    })
  })
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!initialized) initUpdater()

  if (!app.isPackaged) {
    setState({
      status: 'error',
      error: 'Auto-update is only available in packaged builds.',
      releaseUrl: RELEASES_URL
    })
    return currentState
  }

  try {
    setState({ status: 'checking', error: undefined })
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      setState({
        status: 'not-available',
        releaseUrl: RELEASES_URL
      })
    }
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      releaseUrl: RELEASES_URL
    })
  }
  return currentState
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!initialized) initUpdater()

  if (!app.isPackaged) {
    setState({
      status: 'error',
      error: 'Auto-update is only available in packaged builds.',
      releaseUrl: RELEASES_URL
    })
    return currentState
  }

  if (currentState.status === 'downloaded') {
    return currentState
  }

  try {
    setState({ status: 'downloading', error: undefined, progress: undefined })
    await autoUpdater.downloadUpdate()
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      releaseUrl: RELEASES_URL
    })
  }
  return currentState
}

export function quitAndInstall(): void {
  if (!initialized) initUpdater()
  if (currentState.status !== 'downloaded') return
  // isSilent=true: run installer without UI prompts on Windows.
  // isForceRunAfter=true: relaunch the app once installation completes.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
