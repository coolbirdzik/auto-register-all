import type { CreateNewApiKeyOptions, NewApiTokenRecord, ProxyConfig } from '../../shared/contracts'
import type { ProxyManager } from '../proxy/proxy-manager'

interface NewApiListResponse {
  data?: {
    page: number
    page_size: number
    total: number
    items: NewApiTokenRecord[]
  }
  message?: string
  success?: boolean
}

interface NewApiCreateResponse {
  data?: unknown
  message?: string
  success?: boolean
}

export class NewApiTokenClient {
  constructor(private proxyManager: ProxyManager) {}

  async createAndFindLatest(
    baseUrl: string,
    sessionCookie: string,
    userId: string,
    options: CreateNewApiKeyOptions,
    proxy?: ProxyConfig
  ): Promise<NewApiTokenRecord> {
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
    const headers = this.buildHeaders(normalizedBaseUrl, sessionCookie, userId)
    const name = options.name.trim()

    const createRes = await this.fetch(
      `${normalizedBaseUrl}/api/token/`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          remain_quota: Number(options.remainQuota) || 0,
          expired_time: Number(options.expiredTime) || -1,
          unlimited_quota: options.unlimitedQuota,
          model_limits_enabled: options.modelLimitsEnabled,
          model_limits: options.modelLimits.trim(),
          allow_ips: options.allowIps.trim(),
          group: options.group.trim(),
          cross_group_retry: options.crossGroupRetry
        })
      },
      proxy
    )
    const createJson = (await createRes.json().catch(() => ({}))) as NewApiCreateResponse
    if (!createRes.ok || createJson.success === false) {
      throw new Error(createJson.message || `Create API key failed (${createRes.status})`)
    }

    const createdToken = this.parseCreatedToken(createJson.data)
    const createdKey = this.findFullKey(createJson)

    const listRes = await this.fetch(
      `${normalizedBaseUrl}/api/token/?p=1&size=20`,
      { method: 'GET', headers },
      proxy
    )
    const listJson = (await listRes.json().catch(() => ({}))) as NewApiListResponse
    if (!listRes.ok || listJson.success === false) {
      throw new Error(listJson.message || `List API keys failed (${listRes.status})`)
    }

    const items = listJson.data?.items ?? []
    const token = items
      .filter((item) => item.name === name)
      .sort((a, b) => b.created_time - a.created_time || b.id - a.id)[0]
    if (!token) {
      throw new Error('Created API key was not found in token list')
    }
    if (createdKey) {
      return { ...token, ...createdToken, key: createdKey }
    }

    const copiedKey = await this.fetchTokenKey(normalizedBaseUrl, headers, token.id, proxy)
    if (copiedKey) {
      return { ...token, ...createdToken, key: copiedKey }
    }

    const detailToken = await this.fetchTokenDetail(normalizedBaseUrl, headers, token.id, proxy)
    const detailKey = detailToken ? this.findFullKey(detailToken) : null
    if (detailToken && detailKey) {
      return { ...token, ...(this.parseCreatedToken(detailToken) ?? {}), key: detailKey }
    }

    if (token.key.includes('*')) {
      throw new Error('TokenLB returned only a masked API key. The create response did not include the full key.')
    }
    return token
  }

  private async fetchTokenDetail(
    baseUrl: string,
    headers: Record<string, string>,
    tokenId: number,
    proxy?: ProxyConfig
  ): Promise<unknown> {
    const endpoints = [`${baseUrl}/api/token/${tokenId}`, `${baseUrl}/api/token/?id=${tokenId}`]
    for (const endpoint of endpoints) {
      const res = await this.fetch(endpoint, { method: 'GET', headers }, proxy).catch(() => null)
      if (!res?.ok) continue
      const json = await res.json().catch(() => null)
      if (json) return json
    }
    return null
  }

  private async fetchTokenKey(
    baseUrl: string,
    headers: Record<string, string>,
    tokenId: number,
    proxy?: ProxyConfig
  ): Promise<string | null> {
    const res = await this.fetch(
      `${baseUrl}/api/token/${tokenId}/key`,
      { method: 'POST', headers },
      proxy
    ).catch(() => null)
    if (!res?.ok) return null
    const text = await res.text().catch(() => '')
    try {
      return this.findFullKey(JSON.parse(text))
    } catch {
      return this.findFullKey(text)
    }
  }

  private parseCreatedToken(data: unknown): Partial<NewApiTokenRecord> | null {
    if (!data || typeof data !== 'object') return null
    if ('token' in data && data.token && typeof data.token === 'object') return data.token as NewApiTokenRecord
    if ('data' in data && data.data && typeof data.data === 'object') return this.parseCreatedToken(data.data)
    if ('key' in data && typeof data.key === 'string') return data as Partial<NewApiTokenRecord>
    return null
  }

  private findFullKey(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed && !trimmed.includes('*') ? trimmed : null
    }
    if (!value || typeof value !== 'object') return null

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/^(key|token|apiKey|api_key)$/i.test(key) && typeof nested === 'string') {
        const trimmed = nested.trim()
        if (trimmed && !trimmed.includes('*')) return trimmed
      }
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = this.findFullKey(nested)
      if (found) return found
    }

    return null
  }

  private buildHeaders(baseUrl: string, sessionCookie: string, userId: string): Record<string, string> {
    return {
      Accept: 'application/json, text/plain, */*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Cookie: `session=${sessionCookie}`,
      'New-Api-User': userId,
      Origin: baseUrl,
      Pragma: 'no-cache',
      Referer: `${baseUrl}/keys`,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    }
  }

  private fetch(url: string, init: RequestInit, proxy?: ProxyConfig): Promise<Response> {
    const dispatcher = proxy ? this.proxyManager.createFetchDispatcher(proxy) : undefined
    return fetch(url, { ...init, dispatcher } as RequestInit)
  }
}
