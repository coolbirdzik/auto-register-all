import type {
  AccountRecord,
  ApiKeyGroupOption,
  CreatedApiKeyRecord,
  CreateNewApiKeyOptions,
  ProxyConfig
} from '../../shared/contracts'
import type { BrowserPool } from '../browser/browser-pool'
import type { ProxyManager } from '../proxy/proxy-manager'

interface WeiLaiCreateKeyResponse {
  code?: number
  message?: string
  data?: {
    id: number
    user_id?: number
    key: string
    name: string
    group_id?: number
    status?: string
    quota?: number
    created_at?: string
    updated_at?: string
    [key: string]: unknown
  }
}

interface WeiLaiAuthMeResponse {
  code?: number
  message?: string
  data?: unknown
}

interface WeiLaiGroupRecord {
  id: number
  name: string
  platform?: string
  rate_multiplier?: number
  [key: string]: unknown
}

interface WeiLaiGroupListResponse {
  code?: number
  message?: string
  data?: WeiLaiGroupRecord[]
}

interface WeiLaiUpdateKeyResponse {
  code?: number
  message?: string
  data?: Record<string, unknown>
}

const DEFAULT_GROUP_ID = 22
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

export class WeiLaiApiKeyClient {
  constructor(
    private browserPool: BrowserPool,
    private proxyManager: ProxyManager
  ) {}

  async createKey(
    origin: string,
    account: AccountRecord,
    options: CreateNewApiKeyOptions,
    proxy?: ProxyConfig
  ): Promise<CreatedApiKeyRecord> {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for WeiLai login')
    const normalizedOrigin = origin.replace(/\/$/, '')
    console.log('[WeiLai API Key] createKey:start', {
      origin: normalizedOrigin,
      accountId: account.id,
      email: account.email,
      username: account.username,
      profileId: account.browserProfileId,
      proxyId: account.proxyId
    })
    const token = await this.resolveAuthToken(normalizedOrigin, account)
    const name = options.name.trim()
    const groupId = this.resolveGroupId(options.group)
    console.log('[WeiLai API Key] createKey:posting', { name, groupId })

    const res = await this.fetch(
      `${normalizedOrigin}/api/v1/keys`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          Origin: normalizedOrigin,
          Pragma: 'no-cache',
          Referer: `${normalizedOrigin}/keys`,
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({ name, group_id: groupId })
      },
      proxy
    )

    const json = (await res.json().catch(() => ({}))) as WeiLaiCreateKeyResponse
    console.log('[WeiLai API Key] createKey:response', {
      ok: res.ok,
      status: res.status,
      code: json.code,
      message: json.message,
      hasKey: Boolean(json.data?.key),
      id: json.data?.id,
      groupId: json.data?.group_id
    })
    if (!res.ok || json.code !== 0 || !json.data?.key) {
      throw new Error(json.message || `WeiLai create API key failed (${res.status})`)
    }

    return {
      id: json.data.id,
      key: json.data.key,
      name: json.data.name || name,
      createdAt: json.data.created_at,
      siteId: 'weilai-chat',
      metadata: json.data
    }
  }

  async getBalance(
    origin: string,
    account: AccountRecord,
    proxy?: ProxyConfig
  ): Promise<{ balance: number; label: string; metadata?: Record<string, unknown> }> {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for WeiLai balance lookup')
    const normalizedOrigin = origin.replace(/\/$/, '')
    console.log('[WeiLai Balance] start', {
      origin: normalizedOrigin,
      accountId: account.id,
      email: account.email,
      profileId: account.browserProfileId,
      proxyId: account.proxyId
    })
    const token = await this.resolveAuthToken(normalizedOrigin, account)

    const nodeResult = await this.fetchBalanceWithNode(normalizedOrigin, token, proxy).catch((err) => {
      console.log('[WeiLai Balance] node-fetch-error', String(err))
      return null
    })
    if (nodeResult) return nodeResult

    console.log('[WeiLai Balance] falling-back-to-browser-fetch')
    return this.fetchBalanceWithBrowser(account.browserProfileId, normalizedOrigin, token)
  }

  async listGroups(
    origin: string,
    account: AccountRecord,
    proxy?: ProxyConfig
  ): Promise<ApiKeyGroupOption[]> {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for WeiLai group lookup')
    const normalizedOrigin = origin.replace(/\/$/, '')
    console.log('[WeiLai Groups] list:start', { accountId: account.id, email: account.email })
    const token = await this.resolveAuthToken(normalizedOrigin, account)
    const nodeGroups = await this.fetchGroupsWithNode(normalizedOrigin, token, proxy).catch((err) => {
      console.log('[WeiLai Groups] node-fetch-error', String(err))
      return null
    })
    if (nodeGroups) return nodeGroups
    console.log('[WeiLai Groups] falling-back-to-browser-fetch')
    return this.fetchGroupsWithBrowser(account.browserProfileId, normalizedOrigin, token)
  }

  async updateKeyGroup(
    origin: string,
    account: AccountRecord,
    groupId: number,
    proxy?: ProxyConfig
  ): Promise<{ group: ApiKeyGroupOption; metadata?: Record<string, unknown> }> {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for WeiLai group update')
    if (!account.apiKeyId) throw new Error('Account API key id is missing')
    const normalizedOrigin = origin.replace(/\/$/, '')
    console.log('[WeiLai Groups] update:start', { accountId: account.id, keyId: account.apiKeyId, groupId })
    const token = await this.resolveAuthToken(normalizedOrigin, account)
    const groups = await this.listGroups(normalizedOrigin, account, proxy)
    const group = groups.find((item) => item.id === groupId)
    if (!group) throw new Error(`WeiLai group not found: ${groupId}`)

    const nodeResult = await this.updateKeyGroupWithNode(normalizedOrigin, token, account.apiKeyId, groupId, proxy).catch((err) => {
      console.log('[WeiLai Groups] update:node-error', String(err))
      return null
    })
    if (nodeResult) return { group, metadata: nodeResult }

    console.log('[WeiLai Groups] update:fallback-browser')
    const browserResult = await this.updateKeyGroupWithBrowser(account.browserProfileId, normalizedOrigin, token, account.apiKeyId, groupId)
    return { group, metadata: browserResult }
  }

  private resolveGroupId(group: string): number {
    const parsed = Number(String(group || '').trim())
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GROUP_ID
  }

  private async fetchBalanceWithNode(
    origin: string,
    token: string,
    proxy?: ProxyConfig
  ): Promise<{ balance: number; label: string; metadata?: Record<string, unknown> } | null> {
    const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Saigon')
    const res = await this.fetch(
      `${origin}/api/v1/auth/me?timezone=${timezone}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: `${origin}/profile`,
          'User-Agent': USER_AGENT
        }
      },
      proxy
    )
    const json = (await res.json().catch(() => ({}))) as WeiLaiAuthMeResponse
    console.log('[WeiLai Balance] node-response', { ok: res.ok, status: res.status, code: json.code, message: json.message })
    if (!res.ok || json.code !== 0) return null
    return this.parseBalance(json.data)
  }

  private async fetchGroupsWithNode(
    origin: string,
    token: string,
    proxy?: ProxyConfig
  ): Promise<ApiKeyGroupOption[] | null> {
    const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Saigon')
    const res = await this.fetch(
      `${origin}/api/v1/groups/available?timezone=${timezone}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: `${origin}/keys`,
          'User-Agent': USER_AGENT
        }
      },
      proxy
    )
    const json = (await res.json().catch(() => ({}))) as WeiLaiGroupListResponse
    console.log('[WeiLai Groups] node-response', { ok: res.ok, status: res.status, code: json.code, count: json.data?.length })
    if (!res.ok || json.code !== 0 || !Array.isArray(json.data)) return null
    return json.data.map((group) => this.normalizeGroup(group))
  }

  private async fetchGroupsWithBrowser(profileId: string, origin: string, token: string): Promise<ApiKeyGroupOption[]> {
    const session = await this.browserPool.acquire(profileId, undefined, false)
    try {
      await session.navigate(`${origin}/keys`, { timeoutMs: 30000 }).catch(() => undefined)
      session.show()
      await session.executeScript(`localStorage.setItem('auth_token', ${JSON.stringify(token)})`)
      const raw = await session.executeScript<WeiLaiGroupListResponse>(`new Promise(async (resolve) => {
        try {
          const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Saigon');
          const token = localStorage.getItem('auth_token') || ${JSON.stringify(token)};
          const res = await window.fetch('/api/v1/groups/available?timezone=' + timezone, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'en',
              Authorization: 'Bearer ' + token,
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache'
            }
          });
          const json = await res.json().catch(() => ({}));
          resolve({ ...json, _status: res.status, _ok: res.ok });
        } catch (err) {
          resolve({ code: -1, message: String(err) });
        }
      })`)
      console.log('[WeiLai Groups] browser-response', { code: raw.code, message: raw.message, count: raw.data?.length })
      if (raw.code !== 0 || !Array.isArray(raw.data)) throw new Error(raw.message || 'WeiLai group browser fetch failed')
      return raw.data.map((group) => this.normalizeGroup(group))
    } finally {
      this.browserPool.release(session, false, false, true)
    }
  }

  private async updateKeyGroupWithNode(
    origin: string,
    token: string,
    keyId: number,
    groupId: number,
    proxy?: ProxyConfig
  ): Promise<Record<string, unknown> | null> {
    const res = await this.fetch(
      `${origin}/api/v1/keys/${keyId}`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          Origin: origin,
          Pragma: 'no-cache',
          Referer: `${origin}/keys`,
          'User-Agent': USER_AGENT
        },
        body: JSON.stringify({ group_id: groupId })
      },
      proxy
    )
    const json = (await res.json().catch(() => ({}))) as WeiLaiUpdateKeyResponse
    console.log('[WeiLai Groups] update:node-response', { ok: res.ok, status: res.status, code: json.code, message: json.message })
    if (!res.ok || json.code !== 0) return null
    return json.data ?? {}
  }

  private async updateKeyGroupWithBrowser(
    profileId: string,
    origin: string,
    token: string,
    keyId: number,
    groupId: number
  ): Promise<Record<string, unknown>> {
    const session = await this.browserPool.acquire(profileId, undefined, false)
    try {
      await session.navigate(`${origin}/keys`, { timeoutMs: 30000 }).catch(() => undefined)
      session.show()
      await session.executeScript(`localStorage.setItem('auth_token', ${JSON.stringify(token)})`)
      const raw = await session.executeScript<WeiLaiUpdateKeyResponse>(`new Promise(async (resolve) => {
        try {
          const token = localStorage.getItem('auth_token') || ${JSON.stringify(token)};
          const res = await window.fetch('/api/v1/keys/${keyId}', {
            method: 'PUT',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'en',
              Authorization: 'Bearer ' + token,
              'Cache-Control': 'no-cache',
              'Content-Type': 'application/json',
              Pragma: 'no-cache'
            },
            body: JSON.stringify({ group_id: ${groupId} })
          });
          const json = await res.json().catch(() => ({}));
          resolve({ ...json, _status: res.status, _ok: res.ok });
        } catch (err) {
          resolve({ code: -1, message: String(err) });
        }
      })`)
      console.log('[WeiLai Groups] update:browser-response', { code: raw.code, message: raw.message })
      if (raw.code !== 0) throw new Error(raw.message || 'WeiLai key group browser update failed')
      return raw.data ?? {}
    } finally {
      this.browserPool.release(session, false, false, true)
    }
  }

  private normalizeGroup(group: WeiLaiGroupRecord): ApiKeyGroupOption {
    return {
      id: group.id,
      name: group.name,
      platform: String(group.platform ?? ''),
      rateMultiplier: Number(group.rate_multiplier ?? 0)
    }
  }

  private async fetchBalanceWithBrowser(
    profileId: string,
    origin: string,
    token: string
  ): Promise<{ balance: number; label: string; metadata?: Record<string, unknown> }> {
    const session = await this.browserPool.acquire(profileId, undefined, false)
    try {
      await session.navigate(`${origin}/profile`, { timeoutMs: 30000 }).catch(() => undefined)
      session.show()
      await session.executeScript(`localStorage.setItem('auth_token', ${JSON.stringify(token)})`)
      const raw = await session.executeScript<WeiLaiAuthMeResponse>(`new Promise(async (resolve) => {
        try {
          const timezone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Saigon');
          const token = localStorage.getItem('auth_token') || ${JSON.stringify(token)};
          const res = await window.fetch('/api/v1/auth/me?timezone=' + timezone, {
            method: 'GET',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'en',
              Authorization: 'Bearer ' + token,
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache'
            }
          });
          const json = await res.json().catch(() => ({}));
          resolve({ ...json, _status: res.status, _ok: res.ok });
        } catch (err) {
          resolve({ code: -1, message: String(err) });
        }
      })`)
      console.log('[WeiLai Balance] browser-response', {
        code: raw.code,
        message: raw.message,
        status: (raw as Record<string, unknown>)._status,
        ok: (raw as Record<string, unknown>)._ok
      })
      if (raw.code !== 0) {
        throw new Error(raw.message || 'WeiLai balance browser fetch failed')
      }
      return this.parseBalance(raw.data)
    } finally {
      this.browserPool.release(session, false, false, true)
    }
  }

  private parseBalance(data: unknown): { balance: number; label: string; metadata?: Record<string, unknown> } {
    const metadata = data && typeof data === 'object' ? (data as Record<string, unknown>) : { value: data }
    const candidates: unknown[] = []
    const collect = (value: unknown, depth = 0): void => {
      if (depth > 4 || value == null) return
      if (typeof value === 'number' || typeof value === 'string') {
        candidates.push(value)
        return
      }
      if (typeof value !== 'object') return
      const obj = value as Record<string, unknown>
      const preferredKeys = ['balance', 'credit', 'credits', 'quota', 'remaining_quota', 'remain_quota', 'available_balance', 'wallet_balance']
      for (const key of preferredKeys) {
        if (key in obj) candidates.unshift(obj[key])
      }
      for (const [key, nested] of Object.entries(obj)) {
        if (/balance|credit|quota|wallet/i.test(key)) collect(nested, depth + 1)
      }
    }
    collect(data)
    for (const candidate of candidates) {
      const num = typeof candidate === 'number' ? candidate : Number(String(candidate).replace(/[^0-9.-]+/g, ''))
      if (Number.isFinite(num)) {
        return { balance: num, label: `$${num.toFixed(4)}`, metadata }
      }
    }
    console.log('[WeiLai Balance] parse-failed', metadata)
    throw new Error('WeiLai balance was not found in /auth/me response')
  }

  private async resolveAuthToken(origin: string, account: AccountRecord): Promise<string> {
    if (!account.browserProfileId) throw new Error('Account has no browser profile for WeiLai login')

    console.log('[WeiLai API Key] auth:checking-existing-token')
    const existing = await this.readAuthToken(account.browserProfileId, origin, true)
    if (existing) {
      console.log('[WeiLai API Key] auth:existing-token-found', { tokenPrefix: existing.slice(0, 12) })
      return existing
    }

    console.log('[WeiLai API Key] auth:opening-login-page')
    const session = await this.browserPool.acquire(account.browserProfileId, undefined, false)
    try {
      await session.navigate(`${origin}/login`, { timeoutMs: 30000 })
      session.show()
      console.log('[WeiLai API Key] auth:login-dom-ready')
      await session.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="password"]', 20000)
      console.log('[WeiLai API Key] auth:login-inputs-rendered')
      const directLoginResult = await session.executeScript<string>(this.buildDirectLoginScript(account.email || account.username, account.password))
      console.log('[WeiLai API Key] auth:direct-login-result', directLoginResult)
      if (directLoginResult !== 'success') {
        const loginResult = await session.executeScript<string>(this.buildLoginScript(account.email || account.username, account.password))
        console.log('[WeiLai API Key] auth:login-script-result', loginResult)
      }

      const deadline = Date.now() + 60000
      let pollCount = 0
      while (Date.now() < deadline) {
        pollCount++
        const pageToken = await session.executeScript<string | null>(this.tokenReadScript())
        if (pageToken) {
          console.log('[WeiLai API Key] auth:page-token-found', { pollCount, tokenPrefix: pageToken.slice(0, 12) })
          return pageToken
        }
        if (pollCount % 5 === 0) {
          const pageState = await session.executeScript<Record<string, unknown>>(`(() => ({
            url: location.href,
            title: document.title,
            bodyText: (document.body.innerText || '').slice(0, 300),
            localStorageKeys: Object.keys(localStorage),
            sessionStorageKeys: Object.keys(sessionStorage),
            buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
              text: (button.textContent || '').replace(/\s+/g, ' ').trim(),
              disabled: button.disabled,
              type: button.getAttribute('type'),
              ariaDisabled: button.getAttribute('aria-disabled')
            })),
            inputs: Array.from(document.querySelectorAll('input')).map((input) => ({
              type: input.type,
              placeholder: input.placeholder,
              disabled: input.disabled,
              valueLength: input.value ? input.value.length : 0,
              checked: input.checked
            }))
          }))`)
          console.log('[WeiLai API Key] auth:waiting-token-state', { pollCount, pageState })
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } finally {
      this.browserPool.release(session, false, false, true)
    }

    console.log('[WeiLai API Key] auth:checking-final-token')
    const finalToken = await this.readAuthToken(account.browserProfileId, origin, true)
    if (finalToken) {
      console.log('[WeiLai API Key] auth:final-token-found', { tokenPrefix: finalToken.slice(0, 12) })
      return finalToken
    }

    await this.browserPool.showProfile(account.browserProfileId)
    console.log('[WeiLai API Key] auth:token-not-found')
    throw new Error(`WeiLai login token was not found. Sign in at ${origin}/login in this browser profile, then retry.`)
  }

  private async readAuthToken(profileId: string, origin: string, navigateKeys: boolean): Promise<string | null> {
    const session = await this.browserPool.acquire(profileId, undefined, true)
    try {
      if (navigateKeys) {
        console.log('[WeiLai API Key] auth:read-token:navigate-keys')
        await session.navigate(`${origin}/keys`, { timeoutMs: 30000 }).catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      const token = await session.executeScript<string | null>(this.tokenReadScript())
      console.log('[WeiLai API Key] auth:read-token:result', { found: Boolean(token), tokenPrefix: token?.slice(0, 12) })
      return token
    } finally {
      this.browserPool.release(session, false, false, true)
    }
  }

  private buildLoginScript(email: string, password: string): string {
    return `new Promise((resolve) => {
      const debug = (...args) => console.log('[WeiLai Login Script]', ...args);
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const isRendered = (el) => {
        if (!el || el.type === 'hidden') return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const setValue = (el, value) => {
        const previous = el.value || '';
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        try { el.click(); } catch (e) {}
        try { el.focus(); } catch (e) {}
        if (typeof el.select === 'function') { try { el.select(); } catch (e) {} }
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
        if (el._valueTracker) el._valueTracker.setValue(previous);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
        el.blur();
      };
      const findInput = (predicate) => {
        const all = Array.from(document.querySelectorAll('input')).filter(isRendered);
        return all.find(predicate) || null;
      };
      const findEmail = () => findInput((input) => input.type === 'email')
        || findInput((input) => {
          const hay = [input.name, input.id, input.placeholder, input.autocomplete, input.getAttribute('aria-label')].map(normalize).filter(Boolean);
          return hay.some((item) => item.includes('email') || item.includes('mail'));
        });
      const findPassword = () => findInput((input) => input.type === 'password')
        || findInput((input) => {
          const hay = [input.name, input.id, input.placeholder, input.autocomplete, input.getAttribute('aria-label')].map(normalize).filter(Boolean);
          return hay.some((item) => item.includes('password'));
        });
      const findSignInButton = () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isRendered);
        return buttons.find((btn) => {
          const text = normalize(btn.textContent || '');
          return btn.matches('button[type="submit"]') && /(^|\s)(sign\s*in|login|登录|登入)(\s|$)/i.test(text);
        }) || buttons.find((btn) => /(^|\s)(sign\s*in|login|登录|登入)(\s|$)/i.test(normalize(btn.textContent || ''))) || null;
      };
      const tickAgreement = () => {
        debug('tickAgreement:start');
        const candidates = [];
        const checkboxRoles = Array.from(document.querySelectorAll('[role="checkbox"]'));
        for (const cb of checkboxRoles) candidates.push({ el: cb, kind: 'role', checked: () => cb.getAttribute('aria-checked') === 'true' });
        const nativeBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        for (const cb of nativeBoxes) candidates.push({ el: cb, kind: 'native', checked: () => cb.checked });
        debug('tickAgreement:candidates', candidates.map((candidate) => ({
          kind: candidate.kind,
          checked: candidate.checked(),
          text: normalize(((candidate.el.closest('label, div, p, section') || candidate.el.parentElement || candidate.el).textContent) || '').slice(0, 120)
        })));
        const labels = ['agree', '我已阅读并同意', '同意', 'terms', 'i have read'];
        const activate = (candidate) => {
          debug('tickAgreement:activate', { kind: candidate.kind, before: candidate.checked() });
          const el = candidate.el;
          const label = el.closest('label') || document.querySelector('label[for="' + el.id + '"]');
          if (candidate.kind === 'native') {
            if (label) {
              try { label.click(); } catch (e) {}
            } else {
              try { el.click(); } catch (e) {}
            }
            if (!el.checked) {
              try { el.checked = true; } catch (e) {}
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (candidate.kind === 'role') {
            if (label) {
              try { label.click(); } catch (e) {}
            } else {
              try { el.click(); } catch (e) {}
            }
            el.setAttribute('aria-checked', 'true');
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          debug('tickAgreement:after-activate', { kind: candidate.kind, after: candidate.checked() });
        };
        for (const candidate of candidates) {
          const text = normalize(((candidate.el.closest('label, div, p, section') || candidate.el.parentElement || candidate.el).textContent) || '');
          if (!text) continue;
          if (!labels.some((needle) => text.includes(needle))) continue;
          if (!candidate.checked()) {
            activate(candidate);
          }
          debug('tickAgreement:matched-result', { checked: candidate.checked() });
          return candidate.checked();
        }
        for (const candidate of candidates) {
          if (!candidate.checked()) {
            activate(candidate);
            debug('tickAgreement:fallback-result', { checked: candidate.checked() });
            return candidate.checked();
          }
        }
        const anyChecked = candidates.some((candidate) => candidate.checked());
        debug('tickAgreement:any-checked', { anyChecked });
        return anyChecked;
      };

      const start = Date.now();
      const deadline = start + 30000;
      let filledAt = 0;

      const tryFill = () => {
        const emailInput = findEmail();
        const passwordInput = findPassword();
        if (!emailInput || !passwordInput) {
          debug('tryFill:missing-inputs', {
            inputCount: document.querySelectorAll('input').length,
            hasEmail: Boolean(emailInput),
            hasPassword: Boolean(passwordInput)
          });
          return false;
        }
        if (emailInput.disabled || passwordInput.disabled) {
          debug('tryFill:inputs-disabled', { emailDisabled: emailInput.disabled, passwordDisabled: passwordInput.disabled });
          tickAgreement();
          return false;
        }
        debug('tryFill:setting-values');
        if (emailInput.value !== ${JSON.stringify(email)}) setValue(emailInput, ${JSON.stringify(email)});
        if (passwordInput.value !== ${JSON.stringify(password)}) setValue(passwordInput, ${JSON.stringify(password)});
        const filled = emailInput.value === ${JSON.stringify(email)} && passwordInput.value === ${JSON.stringify(password)};
        if (filled && !filledAt) filledAt = Date.now();
        debug('tryFill:result', { filled, emailLength: emailInput.value.length, passwordLength: passwordInput.value.length, filledAt });
        return filled;
      };

      const trySubmit = () => {
        const button = findSignInButton();
        if (!button) {
          debug('trySubmit:no-sign-in-button', Array.from(document.querySelectorAll('button')).map((button) => ({
            text: normalize(button.textContent || ''),
            type: button.getAttribute('type'),
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled')
          })));
          return false;
        }
        debug('trySubmit:button-found', {
          text: normalize(button.textContent || ''),
          type: button.getAttribute('type'),
          disabled: button.disabled,
          ariaDisabled: button.getAttribute('aria-disabled'),
          msSinceFilled: Date.now() - filledAt
        });
        if ((button.disabled || button.getAttribute('aria-disabled') === 'true') && Date.now() - filledAt < 3000) return false;
        if (button.disabled) button.disabled = false;
        button.removeAttribute('disabled');
        button.removeAttribute('aria-disabled');
        try { button.click(); debug('trySubmit:clicked'); } catch (e) { debug('trySubmit:click-error', String(e)); return false; }
        const form = button.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try { form.requestSubmit(button); debug('trySubmit:requestSubmit-called'); } catch (e) { debug('trySubmit:requestSubmit-error', String(e)); }
        }
        return true;
      };

      const poll = () => {
        if (tryFill() && trySubmit()) return resolve('submitted');
        if (Date.now() > deadline) {
          debug('poll:timeout');
          return resolve('timeout');
        }
        window.setTimeout(poll, 500);
      };
      window.setTimeout(poll, 300);
    })`
  }

  private buildDirectLoginScript(email: string, password: string): string {
    return `new Promise(async (resolve) => {
      const debug = (...args) => console.log('[WeiLai Direct Login]', ...args);
      try {
        debug('start', { email: ${JSON.stringify(email)} });
        const res = await window.fetch('/api/v1/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'en',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: ${JSON.stringify(email)},
            password: ${JSON.stringify(password)}
          })
        });
        const json = await res.json().catch(() => ({}));
        debug('response', { ok: res.ok, status: res.status, code: json && json.code, message: json && json.message });
        if (!res.ok || !json || json.code !== 0 || !json.data) {
          return resolve('failed:' + (json && (json.message || json.reason || json.error) || res.status));
        }
        const data = json.data;
        if (data.temp_token) {
          sessionStorage.setItem('weilai_temp_token', data.temp_token);
          return resolve('2fa_required');
        }
        if (!data.access_token) return resolve('failed:no_access_token');
        localStorage.setItem('auth_token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        if (data.expires_in) localStorage.setItem('token_expires_at', String(Date.now() + data.expires_in * 1000));
        if (data.user) localStorage.setItem('auth_user', JSON.stringify(data.user));
        window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: data.access_token }));
        history.replaceState(null, '', '/keys');
        debug('success', { hasRefresh: Boolean(data.refresh_token), hasUser: Boolean(data.user) });
        resolve('success');
      } catch (err) {
        debug('error', String(err));
        resolve('error:' + String(err));
      }
    })`
  }

  private tokenReadScript(): string {
    return `(() => {
      const tokenPattern = /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;
      const keys = ['token', 'access_token', 'accessToken', 'jwt', 'authToken', 'authorization', 'Authorization'];
      const pick = (value) => {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim().replace(/^Bearer\s+/i, '');
        return tokenPattern.test(trimmed) ? trimmed : null;
      };
      const scanValue = (value) => {
        const direct = pick(value);
        if (direct) return direct;
        try {
          const parsed = JSON.parse(value);
          const stack = [parsed];
          while (stack.length) {
            const item = stack.pop();
            if (!item || typeof item !== 'object') continue;
            for (const [key, nested] of Object.entries(item)) {
              if (typeof nested === 'string' && (/token|jwt|authorization/i.test(key) || tokenPattern.test(nested))) {
                const found = pick(nested);
                if (found) return found;
              }
              if (nested && typeof nested === 'object') stack.push(nested);
            }
          }
        } catch {}
        return null;
      };
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of keys) {
          const found = scanValue(storage.getItem(key));
          if (found) return found;
        }
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key) continue;
          const value = storage.getItem(key);
          if (!/token|jwt|auth|user|session/i.test(key || '') && !(value || '').includes('eyJ')) continue;
          const found = scanValue(value);
          if (found) return found;
        }
      }
      return null;
    })()`
  }

  private fetch(url: string, init: RequestInit, proxy?: ProxyConfig): Promise<Response> {
    const dispatcher = proxy ? this.proxyManager.createFetchDispatcher(proxy) : undefined
    return fetch(url, { ...init, dispatcher } as RequestInit)
  }
}
