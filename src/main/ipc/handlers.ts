import { dialog, ipcMain, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { v4 as uuidv4 } from 'uuid'
import type {
  AppSettings,
  BrowserProfile,
  CreateNewApiKeyOptions,
  ExportOptions,
  FreeProxySettings,
  GetApiKeyBalanceOptions,
  ListApiKeyGroupsOptions,
  JobProgressEvent,
  ProxyConfig,
  StartJobOptions,
  UpdateApiKeyGroupOptions,
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
import type { RegistrationLogStore } from '../storage/registration-log-store'
import { AiRouterApiKeyClient } from '../ai-router/api-key-client'
import { NewApiTokenClient } from '../new-api/token-client'
import { WeiLaiApiKeyClient } from '../weilai/api-key-client'

export function registerIpcHandlers(deps: {
  settingsStore: SettingsStore
  registry: ProviderRegistry
  proxyManager: ProxyManager
  browserPool: BrowserPool
  accountStore: AccountStore
  registrationLogStore: RegistrationLogStore
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
    registrationLogStore,
    jobRunner,
    getMainWindow
  } = deps

  const syncFromSettings = (): void => {
    const settings = settingsStore.get()
    proxyManager.setProxies(settings.proxies)
    browserPool.setProfiles(settings.browsers)
  }

  const newApiTokenClient = new NewApiTokenClient(proxyManager)
  const weiLaiApiKeyClient = new WeiLaiApiKeyClient(browserPool, proxyManager)
  const aiRouterApiKeyClient = new AiRouterApiKeyClient(browserPool, proxyManager)

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

  const readSessionCookie = async (profileId: string, origin: string): Promise<string | undefined> => {
    const cookies = await browserPool.getCookies(profileId, origin)
    return cookies.find((cookie) => cookie.name === 'session')?.value
  }

  const waitForSessionCookie = async (profileId: string, origin: string, timeoutMs = 60000): Promise<string | undefined> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const sessionCookie = await readSessionCookie(profileId, origin)
      if (sessionCookie) return sessionCookie
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return undefined
  }

  const loginNewApiAccount = async (
    account: { browserProfileId?: string; username: string; password: string },
    origin: string
  ): Promise<string> => {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for reading login cookies')
    if (!account.username || !account.password) throw new Error('Account username/password is missing')

    // Acquire the profile's BrowserSession so navigation+waitForSelector work correctly
    const session = await browserPool.acquire(account.browserProfileId, undefined, false)
    try {
      await session.navigate(`${origin}/sign-in`, { timeoutMs: 30000 })

      // Wait for the username input to appear (SPA needs time to hydrate)
      await session.waitForSelector('input[name="username"], input[placeholder*="username" i], input[placeholder*="email" i]', 15000)

      const fillScript = `new Promise((resolve) => {
        const normalize = (v) => (v || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const visible = (el) => {
          if (!el || el.disabled || el.type === 'hidden') return false;
          const st = window.getComputedStyle(el);
          const rc = el.getBoundingClientRect();
          return st.display !== 'none' && st.visibility !== 'hidden' && rc.width > 0 && rc.height > 0;
        };
        const setValue = (el, value) => {
          const prev = el.value || '';
          const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (desc && desc.set) desc.set.call(el, value); else el.value = value;
          if (el._valueTracker) el._valueTracker.setValue(prev);
          ['input','change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
        };
        const findInput = (terms, type) => {
          const all = Array.from(document.querySelectorAll('input')).filter(visible);
          if (type) { const t = all.find(i => i.type === type); if (t) return t; }
          return all.find(i => {
            const hay = [i.name, i.id, i.placeholder, i.autocomplete, i.getAttribute('aria-label')].map(normalize).filter(Boolean);
            return terms.some(term => hay.some(h => h.includes(term)));
          }) || null;
        };

        const username = ${JSON.stringify(account.username)};
        const password = ${JSON.stringify(account.password)};

        const userInput = findInput(['username','email','用户名','邮箱'], null);
        const passInput = findInput(['password','密码'], 'password');
        if (!userInput || !passInput) { resolve('no_inputs'); return; }

        setValue(userInput, username);
        setValue(passInput, password);

        // Tick legal-consent checkbox via role="checkbox" span (Base UI custom checkbox)
        const cb = document.querySelector('[role="checkbox"][aria-labelledby="legal-consent-label"]') ||
                   document.querySelector('[role="checkbox"]');
        if (cb && cb.getAttribute('aria-checked') !== 'true') cb.click();

        const submitWhenReady = () => {
          const turnstile = document.querySelector('input[name="cf-turnstile-response"]');
          if (turnstile && !turnstile.value) return false;
          const btns = Array.from(document.querySelectorAll('button')).filter(visible);
          const btn = btns.find(b => normalize(b.textContent).includes('sign in')) || btns[0];
          if (!btn || btn.disabled || btn.hasAttribute('data-disabled')) return false;
          btn.click();
          return true;
        };

        const deadline = Date.now() + 90000;
        const poll = () => {
          if (submitWhenReady()) return resolve('submitted');
          if (Date.now() > deadline) return resolve('not_ready');
          setTimeout(poll, 1000);
        };
        poll();
      })`

      await session.executeScript(fillScript)

      // Poll while the BrowserWindow stays alive; some sessions flush cookies after redirect completes.
      const sessionCookie = await waitForSessionCookie(account.browserProfileId, origin)
      if (sessionCookie) return sessionCookie
    } finally {
      // Release WITHOUT clearing cookies so session persists
      browserPool.release(session, false, false, true)
    }

    // Last chance poll after release. Electron session cookies can include HttpOnly cookies.
    const sessionCookie = await waitForSessionCookie(account.browserProfileId, origin)

    if (!sessionCookie) {
      await browserPool.showProfile(account.browserProfileId)
      throw new Error(`Automatic login failed. Sign in at ${origin}/sign-in in this browser profile, then retry.`)
    }
    return sessionCookie
  }

  const resolveNewApiUserId = async (profileId: string, origin: string, sessionCookie: string): Promise<string | null> => {
    const cookies = await browserPool.getCookies(profileId, origin)
    const userIdCookie = cookies.find((c) => /^new-?api-?user$/i.test(c.name))?.value
    if (userIdCookie && /^\d+$/.test(userIdCookie)) return userIdCookie

    const browserSession = await browserPool.acquire(profileId, undefined, true)
    try {
      await browserSession.navigate(`${origin}/keys`, { timeoutMs: 30000 })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const stored = await browserSession.executeScript<string | null>(
        `(() => {
          const candidates = ['user_id', 'userId', 'new-api-user', 'New-Api-User', 'id'];
          for (const storage of [localStorage, sessionStorage]) {
            for (const key of candidates) {
              const value = storage.getItem(key);
              if (value && /^\\d+$/.test(value)) return value;
            }
            for (let i = 0; i < storage.length; i++) {
              const key = storage.key(i);
              const value = key ? storage.getItem(key) : null;
              if (!value) continue;
              if (/^\\d+$/.test(value) && /user|id/i.test(key || '')) return value;
              try {
                const parsed = JSON.parse(value);
                const id = String(parsed?.id || parsed?.user_id || parsed?.userId || parsed?.user?.id || '');
                if (/^\\d+$/.test(id)) return id;
              } catch {}
            }
          }
          const text = document.body.innerText || '';
          const match = text.match(/(?:user\s*id|uid|id)\D{0,20}(\d{2,})/i);
          return match ? match[1] : null;
        })()`
      )
      if (stored && /^\d+$/.test(stored)) return stored
    } finally {
      browserPool.release(browserSession, false, false, true)
    }

    const endpoints = ['/api/user/self', '/api/user/status', '/api/user']
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${origin}${endpoint}`, {
          headers: {
            Accept: 'application/json',
            Cookie: `session=${sessionCookie}`,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
          }
        } as RequestInit)
        if (!res.ok) continue
        const json = (await res.json()) as Record<string, unknown>
        const data = json.data as Record<string, unknown> | undefined
        const user = (data?.user || json.user) as Record<string, unknown> | undefined
        const id = String(data?.id || data?.user_id || data?.userId || user?.id || json.id || '')
        if (/^\d+$/.test(id)) return id
      } catch {
        // Try the next known New API endpoint shape.
      }
    }

    return null
  }

  const normalizeAiRouterApiBaseUrl = (value: string): string => {
    const trimmed = value.trim().replace(/\/+$/, '')
    if (trimmed.endsWith('/api/v1')) return trimmed
    if (trimmed.endsWith('/api')) return `${trimmed}/v1`
    return `${trimmed}/api/v1`
  }

  const resolveSiteRuntimeConfig = (
    siteId: string,
    settings: AppSettings
  ): {
    uiOrigin: string
    apiBaseUrl?: string
    loginPath?: string
  } => {
    const target = settings.targetSites.find((site) => site.id === siteId || site.providerId === siteId)
    const siteConfig = settings.siteConfigs[siteId] ?? {}

    if (siteId === 'ai-router') {
      const baseUrl = String(siteConfig.baseUrl ?? target?.startUrl ?? 'https://ai-router.dev')
      const apiBaseUrl = normalizeAiRouterApiBaseUrl(String(siteConfig.apiBaseUrl ?? 'https://api.ai-router.dev/api/v1'))
      const loginPath = String(siteConfig.loginPath ?? '/login')
      return {
        uiOrigin: new URL(baseUrl).origin,
        apiBaseUrl,
        loginPath
      }
    }

    const fallbackBaseUrl = siteId === 'weilai-chat' ? 'https://api.weilai.chat' : 'https://tokenlb.net'
    const baseUrl = String(siteConfig.baseUrl ?? target?.startUrl ?? fallbackBaseUrl)
    return { uiOrigin: new URL(baseUrl).origin }
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

  ipcMain.handle('get-registration-logs', () => registrationLogStore.list())

  ipcMain.handle('clear-registration-logs', () => registrationLogStore.clear())

  ipcMain.handle('create-new-api-key', async (_e, options: CreateNewApiKeyOptions) => {
    const account = await accountStore.get(options.accountId)
    if (!account) throw new Error('Account not found')
    if (account.status !== 'success') throw new Error('Only successful accounts can create API keys')
    if (!account.browserProfileId) throw new Error('Account has no browser profile for reading login cookies')

    const settings = settingsStore.get()
    const siteConfig = resolveSiteRuntimeConfig(account.siteId, settings)
    const proxy = account.proxyId ? proxyManager.get(account.proxyId) : undefined

    if (account.siteId === 'tokenlb') {
      const sessionCookie =
        (await readSessionCookie(account.browserProfileId, siteConfig.uiOrigin)) ||
        (await loginNewApiAccount(account, siteConfig.uiOrigin))

      const userId = await resolveNewApiUserId(account.browserProfileId, siteConfig.uiOrigin, sessionCookie)

      if (!userId || !/^\d+$/.test(userId)) {
        await browserPool.showProfile(account.browserProfileId)
        throw new Error('New API user id was not found. Open the account profile and visit the keys page, then retry.')
      }

      const token = await newApiTokenClient.createAndFindLatest(siteConfig.uiOrigin, sessionCookie, userId, options, proxy)
      const normalizedToken = {
        id: token.id,
        key: token.key,
        name: token.name,
        createdAt: new Date(token.created_time * 1000).toISOString(),
        siteId: account.siteId,
        metadata: token as unknown as Record<string, unknown>
      }
      const updated = await accountStore.update(account.id, {
        apiKey: normalizedToken.key,
        apiKeyName: normalizedToken.name,
        apiKeyId: normalizedToken.id,
        apiKeyCreatedAt: normalizedToken.createdAt
      })
      return { account: updated, token: normalizedToken }
    }

    if (account.siteId === 'weilai-chat') {
      const token = await weiLaiApiKeyClient.createKey(siteConfig.uiOrigin, account, options, proxy)
      const updated = await accountStore.update(account.id, {
        apiKey: token.key,
        apiKeyName: token.name,
        apiKeyId: token.id,
        apiKeyCreatedAt: token.createdAt ? new Date(token.createdAt).toISOString() : new Date().toISOString()
      })
      return { account: updated, token }
    }

    if (account.siteId === 'ai-router') {
      const token = await aiRouterApiKeyClient.createKey(
        {
          uiOrigin: siteConfig.uiOrigin,
          apiBaseUrl: String(siteConfig.apiBaseUrl ?? 'https://api.ai-router.dev/api/v1'),
          loginPath: String(siteConfig.loginPath ?? '/login')
        },
        account,
        options,
        proxy
      )
      const updated = await accountStore.update(account.id, {
        apiKey: token.key,
        apiKeyName: token.name,
        apiKeyId: token.id,
        apiKeyCreatedAt: token.createdAt ? new Date(token.createdAt).toISOString() : new Date().toISOString()
      })
      return { account: updated, token }
    }

    throw new Error(`API key creation is not supported for site: ${account.siteId}`)
  })

  ipcMain.handle('get-api-key-balance', async (_e, options: GetApiKeyBalanceOptions) => {
    const account = await accountStore.get(options.accountId)
    if (!account) throw new Error('Account not found')
    if (account.status !== 'success') throw new Error('Only successful accounts can fetch API key balance')
    if (!account.apiKey) throw new Error('Account has no API key')
    if (!account.browserProfileId) throw new Error('Account has no browser profile for reading login token')

    const settings = settingsStore.get()
    const siteConfig = resolveSiteRuntimeConfig(account.siteId, settings)
    const proxy = account.proxyId ? proxyManager.get(account.proxyId) : undefined

    if (account.siteId === 'weilai-chat') {
      const balance = await weiLaiApiKeyClient.getBalance(siteConfig.uiOrigin, account, proxy)
      const updated = await accountStore.update(account.id, {
        apiBalance: balance.balance,
        apiUsedQuota: balance.used,
        apiBalanceLabel: balance.label,
        apiBalanceFetchedAt: new Date().toISOString()
      })
      return { account: updated, ...balance }
    }

    if (account.siteId === 'tokenlb') {
      const sessionCookie =
        (await readSessionCookie(account.browserProfileId, siteConfig.uiOrigin)) ||
        (await loginNewApiAccount(account, siteConfig.uiOrigin))

      const userId = await resolveNewApiUserId(account.browserProfileId, siteConfig.uiOrigin, sessionCookie)
      if (!userId || !/^\d+$/.test(userId)) {
        await browserPool.showProfile(account.browserProfileId)
        throw new Error('New API user id was not found. Open the account profile and visit the keys page, then retry.')
      }

      const balance = await newApiTokenClient.getBalance(siteConfig.uiOrigin, sessionCookie, userId, proxy)
      const updated = await accountStore.update(account.id, {
        apiBalance: balance.balance,
        apiUsedQuota: balance.used,
        apiBalanceLabel: balance.label,
        apiBalanceFetchedAt: new Date().toISOString()
      })
      return { account: updated, ...balance }
    }

    if (account.siteId !== 'ai-router') {
      throw new Error(`Balance lookup is not supported for site: ${account.siteId}`)
    }

    const balance = await aiRouterApiKeyClient.getBalance(
      {
        uiOrigin: siteConfig.uiOrigin,
        apiBaseUrl: String(siteConfig.apiBaseUrl ?? 'https://api.ai-router.dev/api/v1'),
        loginPath: String(siteConfig.loginPath ?? '/login')
      },
      account,
      proxy
    )
    const updated = await accountStore.update(account.id, {
      apiBalance: balance.balance,
      apiUsedQuota: balance.used,
      apiBalanceLabel: balance.label,
      apiBalanceFetchedAt: new Date().toISOString()
    })
    return { account: updated, ...balance }
  })

  ipcMain.handle('list-api-key-groups', async (_e, options: ListApiKeyGroupsOptions) => {
    const account = await accountStore.get(options.accountId)
    if (!account) throw new Error('Account not found')
    if (account.siteId !== 'weilai-chat' && account.siteId !== 'ai-router') {
      throw new Error(`Group lookup is not supported for site: ${account.siteId}`)
    }
    if (account.status !== 'success') throw new Error('Only successful accounts can list API key groups')
    if (!account.browserProfileId) throw new Error('Account has no browser profile for reading login token')

    const settings = settingsStore.get()
    const siteConfig = resolveSiteRuntimeConfig(account.siteId, settings)
    const proxy = account.proxyId ? proxyManager.get(account.proxyId) : undefined

    if (account.siteId === 'weilai-chat') {
      return weiLaiApiKeyClient.listGroups(siteConfig.uiOrigin, account, proxy)
    }

    return aiRouterApiKeyClient.listGroups(
      {
        uiOrigin: siteConfig.uiOrigin,
        apiBaseUrl: String(siteConfig.apiBaseUrl ?? 'https://api.ai-router.dev/api/v1'),
        loginPath: String(siteConfig.loginPath ?? '/login')
      },
      account,
      proxy
    )
  })

  ipcMain.handle('update-api-key-group', async (_e, options: UpdateApiKeyGroupOptions) => {
    const account = await accountStore.get(options.accountId)
    if (!account) throw new Error('Account not found')
    if (account.siteId !== 'weilai-chat' && account.siteId !== 'ai-router') {
      throw new Error(`Group update is not supported for site: ${account.siteId}`)
    }
    if (account.status !== 'success') throw new Error('Only successful accounts can update API key groups')
    if (!account.apiKey) throw new Error('Account has no API key')
    if (!account.apiKeyId) throw new Error('Account API key id is missing')
    if (!account.browserProfileId) throw new Error('Account has no browser profile for reading login token')

    const settings = settingsStore.get()
    const siteConfig = resolveSiteRuntimeConfig(account.siteId, settings)
    const proxy = account.proxyId ? proxyManager.get(account.proxyId) : undefined
    const result =
      account.siteId === 'weilai-chat'
        ? await weiLaiApiKeyClient.updateKeyGroup(siteConfig.uiOrigin, account, options.groupId, proxy)
        : await aiRouterApiKeyClient.updateKeyGroup(
            {
              uiOrigin: siteConfig.uiOrigin,
              apiBaseUrl: String(siteConfig.apiBaseUrl ?? 'https://api.ai-router.dev/api/v1'),
              loginPath: String(siteConfig.loginPath ?? '/login')
            },
            account,
            options.groupId,
            proxy
          )
    const updated = await accountStore.update(account.id, {
      apiKeyGroupId: result.group.id,
      apiKeyGroupName: result.group.name,
      apiKeyGroupPlatform: result.group.platform,
      apiKeyGroupRateMultiplier: result.group.rateMultiplier,
      apiKeyGroupUpdatedAt: new Date().toISOString()
    })
    return { account: updated, group: result.group, metadata: result.metadata }
  })

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
