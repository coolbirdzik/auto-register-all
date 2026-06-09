import { v4 as uuidv4 } from 'uuid'
import type { ProxyConfig, ProxyType, ZingProxySettings } from '../../shared/contracts'

interface ZingProxyLoginResponse {
  status?: string
  statusCode?: number
  accessToken?: string
  data?: ZingProxyLoginResponse
  message?: string
  error?: string
}

type ZingProxyProxyGroup = Record<string, unknown>[]

interface ZingProxyListResponse {
  status?: string
  statusCode?: number
  data?: ZingProxyListResponse
  datacenterIPv4Proxies?: ZingProxyProxyGroup
  datacenterIPv6Proxies?: ZingProxyProxyGroup
  vietnamResidentialProxies?: ZingProxyProxyGroup
  rotatingResidentialProxies?: ZingProxyProxyGroup
  staticResidentialProxies?: ZingProxyProxyGroup
  message?: string
  error?: string
}

const API_BASE_URL = 'https://api.zingproxy.com'
const ACCESS_TOKEN_URL = `${API_BASE_URL}/account/access-token`
const PROXY_LIST_URL = `${API_BASE_URL}/proxy/get-all-active-proxies`

function asString(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function asNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function unwrapData<T extends object>(value: T & { data?: T }): T {
  return value.data && typeof value.data === 'object' ? value.data : value
}

function parseJson<T>(text: string): T | null {
  try {
    return text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    return null
  }
}

function parseLoginCredential(value: unknown): {
  host?: string
  port?: number
  username?: string
  password?: string
} {
  const text = asString(Array.isArray(value) ? value[0] : value)
  if (!text) return {}

  const parts = text.split(':')
  if (parts.length < 4) return {}

  return {
    host: parts[0],
    port: asNumber(parts[1]),
    username: parts.slice(2, -1).join(':'),
    password: parts[parts.length - 1]
  }
}

function makeProxy(
  source: Record<string, unknown>,
  type: ProxyType,
  host: string,
  port: number,
  username?: string,
  password?: string
): ProxyConfig {
  const resourceId = asString(source.resourceId) ?? asString(source.uId) ?? `${host}:${port}`
  const country = asString(source.countryCode)
  const protocol = type.toUpperCase()
  return {
    id: uuidv4(),
    label: `ZingProxy ${resourceId}${country ? ` ${country}` : ''} ${protocol}`,
    type,
    host,
    port,
    username,
    password
  }
}

function convertOne(source: Record<string, unknown>): ProxyConfig[] {
  const proxies: ProxyConfig[] = []
  const loginCredential = parseLoginCredential(source.loginCredentials)
  const host = asString(source.ip) ?? asString(source.hostIp) ?? loginCredential.host
  if (!host) return proxies

  const username = loginCredential.username ?? asString(source.username)
  const password = loginCredential.password ?? asString(source.password)
  const httpPort = asNumber(source.portHttp) ?? loginCredential.port

  if (httpPort) proxies.push(makeProxy(source, 'http', host, httpPort, username, password))

  return proxies
}

function convertList(data: ZingProxyListResponse): ProxyConfig[] {
  const body = unwrapData(data)
  const groups = [
    body.datacenterIPv4Proxies,
    body.datacenterIPv6Proxies,
    body.vietnamResidentialProxies,
    body.rotatingResidentialProxies,
    body.staticResidentialProxies
  ]

  return groups.flatMap((group) =>
    Array.isArray(group) ? group.flatMap((item) => convertOne(item as Record<string, unknown>)) : []
  )
}

export class ZingProxyClient {
  constructor(private settings: ZingProxySettings) {}

  async importProxies(): Promise<ProxyConfig[]> {
    const accessToken = await this.resolveAccessToken()
    const data = await this.list(accessToken)
    return convertList(data)
  }

  private async resolveAccessToken(): Promise<string> {
    const accessToken = asString(this.settings.accessToken)
    if (accessToken) return accessToken

    const email = asString(this.settings.email)
    const password = asString(this.settings.password)
    if (!email || !password) {
      throw new Error('ZingProxy access token is required')
    }

    return this.login(email, password)
  }

  private async login(email: string, password: string): Promise<string> {
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30000)
    })

    const text = await res.text()
    const json = parseJson<ZingProxyLoginResponse>(text)
    if (!res.ok) {
      throw new Error(`ZingProxy access token failed (${res.status}): ${text.slice(0, 300)}`)
    }
    if (!json) {
      throw new Error(`ZingProxy access token returned non-JSON response: ${text.slice(0, 300)}`)
    }

    const body = unwrapData(json)
    if (body.status === 'error' || body.error) {
      throw new Error(`ZingProxy access token failed: ${body.error ?? body.message ?? 'Unknown error'}`)
    }
    const token = asString(body.accessToken)
    if (!token) {
      throw new Error(`ZingProxy access token response did not include accessToken: ${text.slice(0, 300)}`)
    }

    return token
  }

  private async list(accessToken: string): Promise<ZingProxyListResponse> {
    const res = await fetch(PROXY_LIST_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30000)
    })

    const text = await res.text()
    const json = parseJson<ZingProxyListResponse>(text)
    if (!res.ok) {
      throw new Error(`ZingProxy list failed (${res.status}): ${text.slice(0, 300)}`)
    }
    if (!json) {
      throw new Error(`ZingProxy list returned non-JSON response: ${text.slice(0, 300)}`)
    }

    const body = unwrapData(json)
    if (body.status === 'error' || body.error) {
      throw new Error(`ZingProxy list failed: ${body.error ?? body.message ?? 'Unknown error'}`)
    }

    return body
  }
}
