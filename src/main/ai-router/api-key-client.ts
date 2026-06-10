import type {
  AccountRecord,
  ApiKeyGroupOption,
  CreatedApiKeyRecord,
  CreateNewApiKeyOptions,
  ProxyConfig
} from '../../shared/contracts'
import { CloakSession } from '../browser/cloak-session'
import { FormDriver } from '../browser/form-driver'
import type { BrowserPool } from '../browser/browser-pool'
import type { ProxyManager } from '../proxy/proxy-manager'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
const LOGIN_BUTTON_TEXT = ['Login', 'Sign In', 'Sign in']

interface AiRouterSiteConfig {
  uiOrigin: string
  apiBaseUrl: string
  loginPath: string
}

interface WrappedResponse<T> {
  code?: number
  message?: string
  data?: T
}

interface NormalizedRequestOptions {
  token?: string
  proxy?: ProxyConfig
  refererPath?: string
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/api/v1')) return trimmed
  if (trimmed.endsWith('/api')) return `${trimmed}/v1`
  return `${trimmed}/api/v1`
}

export class AiRouterApiKeyClient {
  constructor(
    private browserPool: BrowserPool,
    private proxyManager: ProxyManager
  ) {}

  async createKey(
    config: AiRouterSiteConfig,
    account: AccountRecord,
    options: CreateNewApiKeyOptions,
    proxy?: ProxyConfig
  ): Promise<CreatedApiKeyRecord> {
    const siteConfig = this.normalizeSiteConfig(config)
    const token = await this.resolveAuthToken(siteConfig, account, proxy)
    const keyName = options.name.trim()
    const payload = this.buildCreatePayload(options)
    const record = await this.request<Record<string, unknown>>(siteConfig, '/keys', {
      method: 'POST',
      token,
      proxy,
      refererPath: '/keys',
      body: payload
    })

    const key = this.pickString(record, ['key', 'api_key', 'token'])
    if (!key) {
      throw new Error('AI-ROUTER create key response did not include a full API key')
    }

    return {
      id: Number(record.id ?? 0),
      key,
      name: this.pickString(record, ['name']) ?? keyName,
      createdAt: this.pickString(record, ['created_at', 'createdAt']),
      siteId: 'ai-router',
      metadata: record
    }
  }

  async listGroups(
    config: AiRouterSiteConfig,
    account: AccountRecord,
    proxy?: ProxyConfig
  ): Promise<ApiKeyGroupOption[]> {
    const siteConfig = this.normalizeSiteConfig(config)
    const token = await this.resolveAuthToken(siteConfig, account, proxy)
    const raw = await this.request<unknown>(siteConfig, '/groups/available', {
      method: 'GET',
      token,
      proxy,
      refererPath: '/keys'
    })
    const items = this.extractArray(raw)
    return items
      .map((item) => this.normalizeGroup(item))
      .filter((item): item is ApiKeyGroupOption => Boolean(item))
  }

  async updateKeyGroup(
    config: AiRouterSiteConfig,
    account: AccountRecord,
    groupId: number,
    proxy?: ProxyConfig
  ): Promise<{ group: ApiKeyGroupOption; metadata?: Record<string, unknown> }> {
    if (!account.apiKeyId) throw new Error('Account API key id is missing')

    const siteConfig = this.normalizeSiteConfig(config)
    const token = await this.resolveAuthToken(siteConfig, account, proxy)
    const groups = await this.listGroups(siteConfig, account, proxy)
    const group = groups.find((item) => item.id === groupId)
    if (!group) throw new Error(`AI-ROUTER group not found: ${groupId}`)

    const metadata = await this.request<Record<string, unknown>>(siteConfig, `/keys/${account.apiKeyId}`, {
      method: 'PUT',
      token,
      proxy,
      refererPath: '/keys',
      body: { group_id: groupId }
    })

    return { group, metadata }
  }

  async getBalance(
    config: AiRouterSiteConfig,
    account: AccountRecord,
    proxy?: ProxyConfig
  ): Promise<{ balance: number; label: string; metadata?: Record<string, unknown> }> {
    const siteConfig = this.normalizeSiteConfig(config)
    const token = await this.resolveAuthToken(siteConfig, account, proxy)
    const endpoints = ['/auth/me', '/user/profile']

    for (const endpoint of endpoints) {
      try {
        const data = await this.request<unknown>(siteConfig, endpoint, {
          method: 'GET',
          token,
          proxy,
          refererPath: '/profile'
        })
        const parsed = this.parseBalance(data)
        if (parsed) return parsed
      } catch (err) {
        if (endpoint === endpoints[endpoints.length - 1]) {
          throw err
        }
      }
    }

    throw new Error('AI-ROUTER balance was not found in /auth/me or /user/profile response')
  }

  private normalizeSiteConfig(config: AiRouterSiteConfig): AiRouterSiteConfig {
    return {
      uiOrigin: config.uiOrigin.replace(/\/$/, ''),
      apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
      loginPath: config.loginPath || '/login'
    }
  }

  private buildCreatePayload(options: CreateNewApiKeyOptions): Record<string, unknown> {
    const name = options.name.trim()
    const payload: Record<string, unknown> = { name }
    const groupId = Number(String(options.group || '').trim())
    if (Number.isFinite(groupId) && groupId > 0) payload.group_id = groupId

    const allowIps = options.allowIps
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (allowIps.length > 0) payload.ip_whitelist = allowIps

    if (!options.unlimitedQuota) {
      const quota = Number(options.remainQuota)
      if (Number.isFinite(quota) && quota > 0) payload.quota = quota
    }

    const expiresInDays = Number(options.expiredTime)
    if (Number.isFinite(expiresInDays) && expiresInDays > 0) payload.expires_in_days = expiresInDays

    return payload
  }

  private async resolveAuthToken(
    config: AiRouterSiteConfig,
    account: AccountRecord,
    proxy?: ProxyConfig
  ): Promise<string> {
    if (!account.browserProfileId) {
      throw new Error('Account has no browser profile for AI-ROUTER login')
    }

    const metadataToken = this.readMetadataToken(account)
    if (metadataToken && (await this.isValidToken(config, metadataToken, proxy))) {
      return metadataToken
    }

    const storedToken = await this.readAuthTokenFromProfile(account.browserProfileId, config.uiOrigin)
    if (storedToken && (await this.isValidToken(config, storedToken, proxy))) {
      return storedToken
    }

    const loginUrl = `${config.uiOrigin}${config.loginPath.startsWith('/') ? config.loginPath : `/${config.loginPath}`}`
    const session = await this.browserPool.acquire(account.browserProfileId, undefined, false)
    try {
      await session.navigate(loginUrl, { timeoutMs: 30000 })
      session.show()
      await session.waitForSelector(
        'input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="password"]',
        20000
      )

      await FormDriver.fillField(
        session,
        ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'],
        ['email', 'mail'],
        account.email || account.username
      )
      await FormDriver.fillField(
        session,
        ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="password" i]'],
        ['password'],
        account.password
      )

      let submit = await FormDriver.clickByTextWhenReady(session, LOGIN_BUTTON_TEXT, 8000)
      if (!submit.ok && submit.disabled) {
        await CloakSession.waitForTurnstileToken(session, {
          timeoutMs: 60000,
          manualTimeoutMs: 120000,
          showOnTimeout: true
        })
        submit = await FormDriver.clickByTextWhenReady(session, LOGIN_BUTTON_TEXT, 10000)
      }
      if (!submit.ok) {
        throw new Error(submit.disabled ? 'ai_router_login_button_disabled' : 'ai_router_login_button_not_found')
      }

      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        const token = await session.executeScript<string | null>(this.tokenReadScript()).catch(() => null)
        if (token && (await this.isValidToken(config, token, proxy))) {
          return token
        }
        await sleep(1000)
      }
    } finally {
      this.browserPool.release(session, false, false, true)
    }

    await this.browserPool.showProfile(account.browserProfileId)
    throw new Error(`AI-ROUTER login token was not found. Sign in at ${loginUrl} in this browser profile, then retry.`)
  }

  private readMetadataToken(account: AccountRecord): string | null {
    const metadata = account.metadata
    if (!metadata || typeof metadata !== 'object') return null
    const session = (metadata as Record<string, unknown>).aiRouterSession
    if (!session || typeof session !== 'object') return null
    const token = (session as Record<string, unknown>).authToken
    return typeof token === 'string' && token.trim() ? token.trim() : null
  }

  private async readAuthTokenFromProfile(profileId: string, uiOrigin: string): Promise<string | null> {
    const session = await this.browserPool.acquire(profileId, undefined, true)
    try {
      await session.navigate(`${uiOrigin}/keys`, { timeoutMs: 30000 }).catch(() => undefined)
      await sleep(1000)
      return await session.executeScript<string | null>(this.tokenReadScript()).catch(() => null)
    } finally {
      this.browserPool.release(session, false, false, true)
    }
  }

  private async isValidToken(
    config: AiRouterSiteConfig,
    token: string,
    proxy?: ProxyConfig
  ): Promise<boolean> {
    try {
      await this.request(config, '/auth/me', {
        method: 'GET',
        token,
        proxy,
        refererPath: '/profile'
      })
      return true
    } catch {
      return false
    }
  }

  private async request<T>(
    config: AiRouterSiteConfig,
    endpoint: string,
    options: NormalizedRequestOptions
  ): Promise<T> {
    const url = `${config.apiBaseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: `${config.uiOrigin}${options.refererPath ?? '/keys'}`,
      'User-Agent': USER_AGENT
    }
    if (options.token) headers.Authorization = `Bearer ${options.token}`
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers.Origin = config.uiOrigin
    }

    const res = await this.fetch(
      url,
      {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      },
      options.proxy
    )

    const raw = await res.json().catch(() => null)
    const wrapped = raw as WrappedResponse<T> | null
    const message =
      wrapped && typeof wrapped === 'object' && 'message' in wrapped && typeof wrapped.message === 'string'
        ? wrapped.message
        : undefined

    if (!res.ok) {
      throw new Error(message || `AI-ROUTER request failed (${res.status})`)
    }

    if (wrapped && typeof wrapped === 'object' && 'code' in wrapped) {
      if (wrapped.code !== 0) throw new Error(message || 'AI-ROUTER request failed')
      return (wrapped.data as T) ?? ({} as T)
    }

    return (raw ?? {}) as T
  }

  private extractArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    }
    if (!value || typeof value !== 'object') return []
    const objectValue = value as Record<string, unknown>
    for (const key of ['items', 'groups', 'data', 'list']) {
      const nested = objectValue[key]
      if (Array.isArray(nested)) {
        return nested.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      }
    }
    return []
  }

  private normalizeGroup(value: Record<string, unknown>): ApiKeyGroupOption | null {
    const id = Number(value.id ?? value.group_id)
    const name = this.pickString(value, ['name', 'group_name'])
    if (!Number.isFinite(id) || id < 1 || !name) return null
    return {
      id,
      name,
      platform: this.pickString(value, ['platform', 'provider']) ?? '',
      rateMultiplier: Number(value.rate_multiplier ?? value.rateMultiplier ?? 0)
    }
  }

  private parseBalance(
    data: unknown
  ): { balance: number; label: string; metadata?: Record<string, unknown> } | null {
    const metadata = data && typeof data === 'object' ? (data as Record<string, unknown>) : { value: data }
    const candidates: Array<{ key: string; value: unknown }> = []

    const visit = (value: unknown, path: string, depth: number): void => {
      if (depth > 4 || value == null) return
      if (typeof value === 'number' || typeof value === 'string') {
        if (/balance|credit|quota|remaining|fuel|wallet|available/i.test(path)) {
          candidates.push({ key: path, value })
        }
        return
      }
      if (typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        visit(nested, path ? `${path}.${key}` : key, depth + 1)
      }
    }

    visit(data, '', 0)
    for (const candidate of candidates) {
      const numericValue =
        typeof candidate.value === 'number'
          ? candidate.value
          : Number(String(candidate.value).replace(/[^0-9.-]+/g, ''))
      if (!Number.isFinite(numericValue)) continue
      const label = /balance|credit|fuel|wallet/i.test(candidate.key)
        ? `$${numericValue.toFixed(4)}`
        : `${numericValue}`
      return { balance: numericValue, label, metadata }
    }

    return null
  }

  private pickString(value: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const raw = value[key]
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
    }
    return undefined
  }

  private tokenReadScript(): string {
    return `(() => {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      return token && token.trim() ? token.trim() : null;
    })()`
  }

  private fetch(url: string, init: RequestInit, proxy?: ProxyConfig): Promise<Response> {
    const dispatcher = proxy ? this.proxyManager.createFetchDispatcher(proxy) : undefined
    return fetch(url, { ...init, dispatcher } as RequestInit)
  }
}
