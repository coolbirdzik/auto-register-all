import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import {
  compareSemver,
  downloadMacZip,
  fetchLatestMacRelease,
  installMacUpdate
} from './mac-updater'

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
const IS_MAC = process.platform === 'darwin'

let currentState: UpdateState = {
  status: 'idle',
  currentVersion: ''
}

let listeners = new Set<(state: UpdateState) => void>()
let initialized = false
let macDownloadedZipPath: string | null = null

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

  // On macOS we use a custom updater path (mac-updater.ts) so that unsigned
  // builds can self-update. Squirrel.Mac requires matching code signatures
  // and we cannot satisfy that without an Apple Developer cert.
  if (IS_MAC) return

  // Windows: drive electron-updater manually so we can control the lifecycle.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false

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

async function checkMacForUpdates(): Promise<UpdateState> {
  try {
    setState({ status: 'checking', error: undefined })
    const release = await fetchLatestMacRelease()
    const current = app.getVersion()
    const isNewer = release.version && compareSemver(release.version, current) > 0
    if (!isNewer) {
      setState({
        status: 'not-available',
        latestVersion: release.version,
        releaseUrl: release.releaseUrl || RELEASES_URL
      })
      return currentState
    }
    if (!release.zipUrl) {
      setState({
        status: 'error',
        latestVersion: release.version,
        releaseUrl: release.releaseUrl || RELEASES_URL,
        error: `No matching .zip asset for arch ${process.arch}`
      })
      return currentState
    }
    setState({
      status: 'available',
      latestVersion: release.version,
      releaseName: release.releaseName,
      releaseUrl: release.releaseUrl || RELEASES_URL
    })
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      releaseUrl: RELEASES_URL
    })
  }
  return currentState
}

async function downloadMacUpdate(): Promise<UpdateState> {
  try {
    const release = await fetchLatestMacRelease()
    if (!release.zipUrl) throw new Error(`No .zip asset for arch ${process.arch}`)

    setState({
      status: 'downloading',
      latestVersion: release.version,
      releaseName: release.releaseName,
      releaseUrl: release.releaseUrl || RELEASES_URL,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: undefined
    })

    const zipPath = await downloadMacZip(release.zipUrl, (progress) => {
      setState({
        status: 'downloading',
        progress: {
          percent: Math.max(0, Math.min(100, progress.percent)),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        }
      })
    })

    macDownloadedZipPath = zipPath
    setState({
      status: 'downloaded',
      latestVersion: release.version,
      releaseUrl: release.releaseUrl || RELEASES_URL,
      progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 }
    })
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      releaseUrl: RELEASES_URL
    })
  }
  return currentState
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

  if (IS_MAC) return checkMacForUpdates()

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

  if (IS_MAC) return downloadMacUpdate()

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

  if (IS_MAC) {
    if (!macDownloadedZipPath) return
    void installMacUpdate(macDownloadedZipPath).catch((err) => {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        releaseUrl: RELEASES_URL
      })
    })
    return
  }

  // Windows: isSilent=true runs NSIS silently, isForceRunAfter=true relaunches.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
