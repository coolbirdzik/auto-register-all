import type { ProxyConfig } from '../../../shared/contracts'
import type { ProxyManager } from '../../proxy/proxy-manager'

export interface RegisterPayload {
  username: string
  password: string
  email: string
  verification_code: string
  aff_code?: string
}

export class TokenLBApiClient {
  constructor(private proxyManager: ProxyManager) {}

  private async fetch(
    url: string,
    init: RequestInit,
    proxy?: ProxyConfig
  ): Promise<Response> {
    const dispatcher = this.proxyManager.createFetchDispatcher(proxy)
    return fetch(url, { ...init, dispatcher } as RequestInit)
  }

  async sendVerification(
    baseUrl: string,
    email: string,
    turnstile: string,
    proxy?: ProxyConfig
  ): Promise<void> {
    const params = new URLSearchParams({ email, turnstile })
    const res = await this.fetch(`${baseUrl}/api/verification?${params}`, { method: 'GET' }, proxy)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Verification request failed (${res.status}): ${body}`)
    }
  }

  async register(baseUrl: string, payload: RegisterPayload, proxy?: ProxyConfig): Promise<void> {
    const body: Record<string, string> = {
      username: payload.username,
      password: payload.password,
      email: payload.email,
      verification_code: payload.verification_code
    }
    if (payload.aff_code) body.aff_code = payload.aff_code

    const res = await this.fetch(
      `${baseUrl}/api/user/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      proxy
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Registration failed (${res.status}): ${text}`)
    }
  }

  async getStatus(baseUrl: string, proxy?: ProxyConfig): Promise<Record<string, unknown>> {
    const res = await this.fetch(`${baseUrl}/api/status`, { method: 'GET' }, proxy)
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
    return res.json() as Promise<Record<string, unknown>>
  }
}
