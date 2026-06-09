import { dialog, ipcMain, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import type {
  AppSettings,
  BrowserProfile,
  ExportOptions,
  FreeProxySettings,
  JobProgressEvent,
  ProxyConfig,
  StartJobOptions,
  ZingProxySettings
} from '../../shared/contracts'
import type { BrowserPool } from '../browser/browser-pool'
import type { JobRunner } from '../core/job-runner'
import type { ProviderRegistry } from '../core/registry'
import { parseProxyList } from '../proxy/proxy-parser'
import { FreeProxyClient } from '../proxy/free-proxy-client'
import { ZingProxyClient } from '../proxy/zingproxy-client'
import type { ProxyManager } from '../proxy/proxy-manager'
import type { SettingsStore } from '../settings'
import type { AccountStore } from '../storage/account-store'

export function registerIpcHandlers(deps: {
  settingsStore: SettingsStore
  registry: ProviderRegistry
  proxyManager: ProxyManager
  browserPool: BrowserPool
  accountStore: AccountStore
  jobRunner: JobRunner
  getMainWindow: () => BrowserWindow | null
  onJobProgress: (event: JobProgressEvent) => void
}): void {
  const {
    settingsStore,
    registry,
    proxyManager,
    browserPool,
    accountStore,
    jobRunner,
    getMainWindow
  } = deps

  const syncFromSettings = (): void => {
    const settings = settingsStore.get()
    proxyManager.setProxies(settings.proxies)
    browserPool.setProfiles(settings.browsers)
  }

  const importProxyBatch = (proxies: ProxyConfig[]): ProxyConfig[] => {
    const existing = new Set(
      proxyManager.list().map((p) => `${p.type}:${p.host}:${p.port}:${p.username ?? ''}`)
    )
    const unique = proxies.filter((proxy) => {
      const key = `${proxy.type}:${proxy.host}:${proxy.port}:${proxy.username ?? ''}`
      if (existing.has(key)) return false
      existing.add(key)
      return true
    })
    const added = unique.filter((proxy) => proxyManager.add(proxy))
    settingsStore.updateProxies(proxyManager.list())
    return added
  }

  syncFromSettings()

  ipcMain.handle('get-settings', () => settingsStore.get())

  ipcMain.handle('save-settings', (_e, partial: Partial<AppSettings>) => {
    settingsStore.save(partial)
    syncFromSettings()
  })

  ipcMain.handle('list-sites', () => registry.listSites())
  ipcMain.handle('list-email-providers', () => registry.listEmails())

  ipcMain.handle('list-proxies', () => proxyManager.list())

  ipcMain.handle('add-proxy', (_e, proxy: ProxyConfig) => {
    proxyManager.add(proxy)
    settingsStore.updateProxies(proxyManager.list())
  })

  ipcMain.handle('import-proxies', (_e, text: string) => {
    const imported = parseProxyList(text)
    return importProxyBatch(imported)
  })

  ipcMain.handle('import-zingproxy-proxies', async (_e, config: ZingProxySettings) => {
    const current = settingsStore.get()
    settingsStore.save({
      proxyProviders: {
        ...current.proxyProviders,
        zingproxy: {
          ...(current.proxyProviders?.zingproxy ?? {}),
          ...config
        }
      }
    })

    const client = new ZingProxyClient(settingsStore.get().proxyProviders?.zingproxy ?? config)
    const fetched = await client.importProxies()
    const added = importProxyBatch(fetched)

    return {
      imported: added,
      skipped: fetched.length - added.length,
      message: `Fetched ${fetched.length} proxy endpoint(s)`
    }
  })

  ipcMain.handle('import-free-proxies', async (_e, config: FreeProxySettings) => {
    const current = settingsStore.get()
    settingsStore.save({
      proxyProviders: {
        ...current.proxyProviders,
        freeProxy: {
          ...(current.proxyProviders?.freeProxy ?? {}),
          ...config
        }
      }
    })

    const client = new FreeProxyClient(settingsStore.get().proxyProviders?.freeProxy ?? config)
    const fetched = await client.importProxies()
    const added = importProxyBatch(fetched)

    return {
      imported: added,
      skipped: fetched.length - added.length,
      message: `Fetched ${fetched.length} proxy endpoint(s)`
    }
  })

  ipcMain.handle('test-proxy', async (_e, proxyId: string) => {
    const proxy = proxyManager.get(proxyId)
    if (!proxy) throw new Error(`Proxy not found: ${proxyId}`)
    return proxyManager.test(proxy)
  })

  ipcMain.handle('remove-proxy', (_e, proxyId: string) => {
    proxyManager.remove(proxyId)
    settingsStore.updateProxies(proxyManager.list())
  })

  ipcMain.handle('list-browser-profiles', () => browserPool.listProfiles())

  ipcMain.handle('create-browser-profile', (_e, config: Partial<BrowserProfile>) => {
    const profile = browserPool.createProfile(config)
    settingsStore.updateBrowsers(browserPool.listProfiles())
    return profile
  })

  ipcMain.handle('delete-browser-profile', (_e, id: string) => {
    browserPool.deleteProfile(id)
    settingsStore.updateBrowsers(browserPool.listProfiles())
  })

  ipcMain.handle('show-browser-profile', async (_e, id: string) => {
    await browserPool.showProfile(id)
  })

  ipcMain.handle('start-job', async (_e, options: StartJobOptions) => {
    if (jobRunner.isRunning()) {
      throw new Error('A batch is already running')
    }

    if (!options?.siteId || !options?.emailProviderId) {
      throw new Error('Site and email provider are required')
    }

    const settings = settingsStore.get()
    if (options.targetSiteId) {
      const targetSite = settings.targetSites.find((target) => target.id === options.targetSiteId)
      if (!targetSite) {
        throw new Error('Target site not found')
      }
      if (!targetSite.enabled) {
        throw new Error('Target site is disabled')
      }
      if (targetSite.providerId !== options.siteId) {
        throw new Error('Target site provider does not match selected site provider')
      }
    }
    const customEmail = String(options.customEmail ?? '').trim()
    const emailProvider = registry.getEmail(options.emailProviderId)
    const emailConfig = settings.emailProviders[options.emailProviderId] ?? {}
    if (!customEmail && emailProvider.validateConfig) {
      const valid = await emailProvider.validateConfig(emailConfig)
      if (!valid) {
        throw new Error(
          `${emailProvider.name} is not configured. Open Settings, complete the required fields, and click Save.`
        )
      }
    }

    const count = Number(options.count)
    if (!options.continuous && (!Number.isFinite(count) || count < 1)) {
      throw new Error('Count must be at least 1')
    }

    const maxConcurrent = Number(options.maxConcurrent ?? settings.defaults.maxConcurrent)
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('Max concurrent must be at least 1')
    }

    if (options.browser?.mode === 'fixed' && !options.browser.profileId) {
      throw new Error('Select a browser profile for fixed browser mode')
    }

    if (options.proxy?.mode === 'fixed' && !options.proxy.proxyId) {
      throw new Error('Select a proxy for fixed proxy mode')
    }

    return jobRunner.startBatch(options)
  })

  ipcMain.handle('cancel-job', () => {
    jobRunner.cancelAllJobs()
  })

  ipcMain.handle('get-accounts', (_e, filter?) => accountStore.list(filter))

  ipcMain.handle('delete-account', (_e, id: string) => accountStore.delete(id))

  ipcMain.handle('delete-accounts', (_e, ids: string[]) => accountStore.deleteMany(ids))

  ipcMain.handle('export-accounts', async (_e, options: ExportOptions) => {
    const accounts = await accountStore.exportFiltered(options.filter, options.successOnly)
    const win = getMainWindow()
    const saveDialogOptions = {
      title: 'Export Accounts',
      defaultPath: `accounts-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, saveDialogOptions)
      : await dialog.showSaveDialog(saveDialogOptions)
    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }
    await writeFile(result.filePath, JSON.stringify(accounts, null, 2), 'utf-8')
    return { canceled: false, path: result.filePath }
  })

  ipcMain.handle('test-email-provider', async (_e, providerId: string) => {
    const provider = registry.getEmail(providerId)
    const settings = settingsStore.get()
    const profile = browserPool.listProfiles()[0]
    const browser = profile
      ? await browserPool.acquire(profile.id)
      : await browserPool.acquire(undefined)

    try {
      const ctx = {
        jobId: uuidv4(),
        siteId: settings.defaults.siteId,
        emailProviderId: providerId,
        browser,
        proxy: undefined,
        settings,
        headless: settings.defaults.headless ?? true,
        log: () => undefined,
        abortSignal: AbortSignal.timeout(30000)
      }
      const inbox = await provider.createInbox(ctx)
      return { success: true, email: inbox.address }
    } finally {
      browserPool.release(browser, false, false)
    }
  })
}
