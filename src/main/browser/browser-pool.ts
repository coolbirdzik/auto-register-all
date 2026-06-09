import { BrowserWindow, session as electronSession, type Cookie } from 'electron'
import type { BrowserProfile, BrowserSession, ProxyConfig } from '../../shared/contracts'
import type { ProxyManager } from '../proxy/proxy-manager'
import { createBrowserProfile } from './browser-profile'

class ElectronBrowserSession implements BrowserSession {
  private window: BrowserWindow

  constructor(
    readonly profileId: string,
    readonly partition: string,
    readonly proxy: ProxyConfig | undefined,
    window: BrowserWindow
  ) {
    this.window = window
  }

  async navigate(url: string, options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 60000

    await new Promise<void>((resolve, reject) => {
      const { webContents } = this.window
      let settled = false

      const timer = setTimeout(() => {
        settle(new Error(`Navigation timeout: ${url}`))
      }, timeoutMs)

      const settle = (err?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (err) reject(err)
        else resolve()
      }

      const cleanup = (): void => {
        clearTimeout(timer)
        webContents.removeListener('dom-ready', onReady)
        webContents.removeListener('did-finish-load', onReady)
        webContents.removeListener('did-frame-finish-load', onFrameFinish)
        webContents.removeListener('did-fail-load', onFail)
      }

      const onReady = (): void => {
        settle()
      }

      const onFrameFinish = (_event: unknown, isMainFrame: boolean): void => {
        if (isMainFrame) settle()
      }

      const onFail = (
        _event: unknown,
        code: number,
        desc: string,
        _validatedUrl: string,
        isMainFrame?: boolean
      ): void => {
        if (code === -3) return
        if (isMainFrame === false) return
        settle(new Error(`Navigation failed: ${desc}`))
      }

      webContents.on('dom-ready', onReady)
      webContents.on('did-finish-load', onReady)
      webContents.on('did-frame-finish-load', onFrameFinish)
      webContents.on('did-fail-load', onFail)

      void this.window.loadURL(url).then(onReady).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        settle(new Error(`Navigation failed: ${message}`))
      })
    })
  }

  async executeScript<T>(script: string | (() => T)): Promise<T> {
    if (this.window.isDestroyed()) {
      throw new Error('Browser window destroyed')
    }
    const { webContents } = this.window
    try {
      if (typeof script === 'function') {
        return await webContents.executeJavaScript(`(${script.toString()})()`, true)
      }
      return await webContents.executeJavaScript(script, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`executeScript failed: ${message}`)
    }
  }

  async waitForSelector(selector: string, timeoutMs = 30000): Promise<boolean> {
    const script = `
      new Promise((resolve) => {
        const deadline = Date.now() + ${timeoutMs};
        const tick = () => {
          if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(tick, 300);
        };
        tick();
      })
    `
    return this.window.webContents.executeJavaScript(script)
  }

  show(): void {
    this.window.show()
    this.window.focus()
  }

  hide(): void {
    this.window.hide()
  }

  destroy(): void {
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}

export class BrowserPool {
  private profiles: BrowserProfile[] = []
  private sessions = new Map<string, ElectronBrowserSession>()
  private windows = new Map<string, BrowserWindow>()
  private inUse = new Set<string>()
  private roundRobinIndex = 0
  private readonly maxConcurrent: number
  private readonly defaultTimeoutMs: number

  constructor(
    private proxyManager: ProxyManager,
    options?: { maxConcurrent?: number; defaultTimeoutMs?: number }
  ) {
    this.maxConcurrent = options?.maxConcurrent ?? 1
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 60000
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent
  }

  setProfiles(profiles: BrowserProfile[]): void {
    this.profiles = [...profiles]
  }

  listProfiles(): BrowserProfile[] {
    return [...this.profiles]
  }

  createProfile(config: Partial<BrowserProfile>): BrowserProfile {
    const profile = createBrowserProfile({
      ...config,
      label: config.label ?? `Browser ${this.profiles.length + 1}`
    })
    this.profiles.push(profile)
    return profile
  }

  deleteProfile(profileId: string): void {
    const session = this.sessions.get(profileId)
    if (session) {
      session.destroy()
      this.sessions.delete(profileId)
      this.windows.delete(profileId)
    }
    this.profiles = this.profiles.filter((p) => p.id !== profileId)
    this.inUse.delete(profileId)
  }

  private async createWindow(
    profile: BrowserProfile,
    proxy?: ProxyConfig,
    headless?: boolean
  ): Promise<BrowserWindow> {
    const ses = electronSession.fromPartition(profile.partition)
    if (proxy) {
      await this.proxyManager.applyToSession(ses, proxy)
    } else {
      await ses.setProxy({ mode: 'direct' })
    }

    const show = headless !== undefined ? !headless : profile.visible

    const win = new BrowserWindow({
      show,
      width: 1024,
      height: 768,
      webPreferences: {
        partition: profile.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    if (profile.userAgent) {
      win.webContents.setUserAgent(profile.userAgent)
    }

    return win
  }

  private resolveProxy(profile: BrowserProfile, overrideProxy?: ProxyConfig): ProxyConfig | undefined {
    if (overrideProxy) return overrideProxy
    if (profile.proxyId) return this.proxyManager.get(profile.proxyId)
    return undefined
  }

  async acquire(profileId?: string, proxy?: ProxyConfig, headless = true): Promise<BrowserSession> {
    const profile = profileId
      ? this.profiles.find((p) => p.id === profileId)
      : this.pickAvailableProfile()

    if (!profile) {
      const created = this.createProfile({ label: 'Auto Browser' })
      return this.acquire(created.id, proxy)
    }

    if (this.inUse.has(profile.id)) {
      throw new Error(`Browser profile ${profile.id} is already in use`)
    }

    const resolvedProxy = this.resolveProxy(profile, proxy)
    let win = this.windows.get(profile.id)

    if (!win || win.isDestroyed()) {
      win = await this.createWindow(profile, resolvedProxy, headless)
      this.windows.set(profile.id, win)
    } else if (resolvedProxy) {
      const ses = electronSession.fromPartition(profile.partition)
      await this.proxyManager.applyToSession(ses, resolvedProxy)
    }

    if (!headless) {
      win.show()
      win.focus()
    }

    const browserSession = new ElectronBrowserSession(profile.id, profile.partition, resolvedProxy, win)
    this.sessions.set(profile.id, browserSession)
    this.inUse.add(profile.id)
    return browserSession
  }

  private pickAvailableProfile(): BrowserProfile | undefined {
    const available = this.profiles.filter((p) => !this.inUse.has(p.id))
    if (available.length === 0) {
      if (this.profiles.length < this.maxConcurrent) return undefined
      return available[this.roundRobinIndex++ % Math.max(available.length, 1)]
    }
    const profile = available[this.roundRobinIndex++ % available.length]
    return profile
  }

  release(session: BrowserSession, destroy = false, clearCookies = false, headless = true): void {
    this.inUse.delete(session.profileId)
    if (clearCookies) {
      const ses = electronSession.fromPartition(session.partition)
      void ses.clearStorageData()
    }
    if (destroy) {
      session.destroy()
      this.sessions.delete(session.profileId)
      this.windows.delete(session.profileId)
    } else if (headless) {
      session.hide()
    }
  }

  pickProfileForJob(
    mode: 'auto' | 'fixed' | 'rotate',
    jobIndex: number,
    profileId?: string,
    profileIds?: string[]
  ): string | undefined {
    if (mode === 'fixed' && profileId) return profileId
    if (mode === 'rotate' && profileIds && profileIds.length > 0) {
      return profileIds[jobIndex % profileIds.length]
    }
    const available = this.profiles.filter((p) => !this.inUse.has(p.id))
    if (available.length > 0) {
      return available[jobIndex % available.length].id
    }
    if (this.profiles.length > 0) {
      return this.profiles[jobIndex % this.profiles.length].id
    }
    return undefined
  }

  async showProfile(profileId: string): Promise<void> {
    const profile = this.profiles.find((p) => p.id === profileId)
    if (!profile) throw new Error(`Profile not found: ${profileId}`)
    const proxy = this.resolveProxy(profile)
    let win = this.windows.get(profileId)
    if (!win || win.isDestroyed()) {
      win = await this.createWindow(profile, proxy)
      this.windows.set(profileId, win)
    }
    win.show()
    win.focus()
  }

  async getCookies(profileId: string, url: string): Promise<Cookie[]> {
    const profile = this.profiles.find((p) => p.id === profileId)
    if (!profile) throw new Error(`Profile not found: ${profileId}`)
    const ses = electronSession.fromPartition(profile.partition)
    const byUrl = await ses.cookies.get({ url })
    if (byUrl.length > 0) return byUrl

    const hostname = new URL(url).hostname
    const all = await ses.cookies.get({})
    return all.filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, '')
      return hostname === domain || hostname.endsWith(`.${domain}`)
    })
  }

  async executeInProfile<T>(profileId: string, url: string, script: string): Promise<T> {
    const profile = this.profiles.find((p) => p.id === profileId)
    if (!profile) throw new Error(`Profile not found: ${profileId}`)
    const proxy = this.resolveProxy(profile)
    let win = this.windows.get(profileId)
    if (!win || win.isDestroyed()) {
      win = await this.createWindow(profile, proxy, true)
      this.windows.set(profileId, win)
    }
    if (!win.webContents.getURL().startsWith(new URL(url).origin)) {
      await win.loadURL(url)
    }
    return win.webContents.executeJavaScript(script, true)
  }
}
