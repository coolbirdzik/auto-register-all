import { randomUUID } from 'crypto'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { BrowserPool } from './browser/browser-pool'
import { ProviderRegistry } from './core/registry'
import { JobRunner } from './core/job-runner'
import { EmailnatorProvider } from './email-providers/emailnator'
import { GmailnatorProvider } from './email-providers/gmailnator'
import { registerIpcHandlers } from './ipc/handlers'
import { ProxyManager } from './proxy/proxy-manager'
import { SettingsStore } from './settings'
import { AiRouterProvider } from './site-providers/ai-router'
import { TokenLBProvider } from './site-providers/tokenlb'
import { WeiLaiChatProvider } from './site-providers/weilai-chat'
import { AccountStore } from './storage/account-store'
import { RegistrationLogStore } from './storage/registration-log-store'
import type { JobProgressEvent, ManualOtpRequest } from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
const APP_TITLE = 'Auto Register'
const LEGACY_USER_DATA_DIR = 'tokenlb-auto-register'

app.setName(APP_TITLE)
app.setPath('userData', join(app.getPath('appData'), LEGACY_USER_DATA_DIR))

const settingsStore = new SettingsStore()
const proxyManager = new ProxyManager()
const registry = new ProviderRegistry()
const accountStore = new AccountStore()
const registrationLogStore = new RegistrationLogStore()
const manualOtpRequests = new Map<
  string,
  {
    resolve: (code: string) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  }
>()

const settings = settingsStore.get()
proxyManager.setProxies(settings.proxies)

const browserPool = new BrowserPool(proxyManager, {
  maxConcurrent: settings.defaults.maxConcurrent
})

registry.registerEmail(new GmailnatorProvider(proxyManager))
registry.registerEmail(new EmailnatorProvider(proxyManager))
registry.registerSite(new TokenLBProvider(registry, proxyManager))
registry.registerSite(new WeiLaiChatProvider(registry, proxyManager))
registry.registerSite(new AiRouterProvider(registry, proxyManager))
browserPool.setProfiles(settings.browsers)

function broadcastProgress(event: JobProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('job-progress', event)
  }
}

function requestManualOtp(request: Omit<ManualOtpRequest, 'requestId'>): Promise<string> {
  const requestId = randomUUID()
  const payload: ManualOtpRequest = { ...request, requestId }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manualOtpRequests.delete(requestId)
      reject(new Error('manual_otp_timeout'))
    }, 10 * 60 * 1000)

    manualOtpRequests.set(requestId, { resolve, reject, timer })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('manual-otp-request', payload)
    }
  })
}

ipcMain.handle('submit-manual-otp', (_event, requestId: string, code: string) => {
  const pending = manualOtpRequests.get(requestId)
  if (!pending) {
    throw new Error('OTP request is no longer active')
  }

  const normalizedCode = String(code ?? '').trim()
  if (!normalizedCode) {
    throw new Error('OTP code is required')
  }

  clearTimeout(pending.timer)
  manualOtpRequests.delete(requestId)
  pending.resolve(normalizedCode)
})

const jobRunner = new JobRunner(
  registry,
  browserPool,
  proxyManager,
  accountStore,
  registrationLogStore,
  () => settingsStore.get(),
  broadcastProgress,
  requestManualOtp
)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    title: APP_TITLE,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.on('login', (event, _wc, _details, authInfo, callback) => {
    if (authInfo.isProxy) {
      const proxy = proxyManager.getByEndpoint(authInfo.host, authInfo.port)
      if (proxy?.username) {
        event.preventDefault()
        callback(proxy.username, proxy.password ?? '')
      }
    }
  })

  registerIpcHandlers({
    settingsStore,
    registry,
    proxyManager,
    browserPool,
    accountStore,
    registrationLogStore,
    jobRunner,
    getMainWindow: () => mainWindow,
    onJobProgress: broadcastProgress
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
