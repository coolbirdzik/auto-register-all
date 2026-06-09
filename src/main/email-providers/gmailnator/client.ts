import type { JobContext } from '../../../shared/contracts/job-context'
import type { ProxyManager } from '../../proxy/proxy-manager'
import type {
  GmailnatorGenerateResponse,
  GmailnatorInboxResponse,
  GmailnatorMessageResponse
} from './types'

const BASE_URL = 'https://gmailnator.p.rapidapi.com/api'
const GMAIL_TYPES = new Set([
  'public_gmail_plus',
  'public_gmail_dot',
  'public_googlemail',
  'private_gmail_plus',
  'private_gmail_dot',
  'private_googlemail'
])

export class GmailnatorClient {
  constructor(private proxyManager: ProxyManager) {}

  private getConfig(ctx: JobContext): { apiKey: string; emailType: string } {
    const config = ctx.settings.emailProviders.gmailnator ?? {}
    const apiKey = String(config.apiKey ?? '')
    if (!apiKey) throw new Error('Gmailnator API key not configured')
    const emailType = String(config.emailType ?? 'public_gmail_plus')
    if (!GMAIL_TYPES.has(emailType)) {
      throw new Error(`Unsupported Gmailnator email type: ${emailType}`)
    }

    return {
      apiKey,
      emailType
    }
  }

  private async request<T>(
    ctx: JobContext,
    path: string,
    init: RequestInit
  ): Promise<T> {
    const { apiKey } = this.getConfig(ctx)
    const dispatcher = this.proxyManager.createFetchDispatcher(ctx.proxy)
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      dispatcher,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'gmailnator.p.rapidapi.com',
        ...(init.headers as Record<string, string>)
      },
      signal: ctx.abortSignal
    } as RequestInit)

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gmailnator API error ${res.status}: ${body}`)
    }

    return res.json() as Promise<T>
  }

  async generate(ctx: JobContext): Promise<string> {
    const { emailType } = this.getConfig(ctx)
    const data = await this.generateWithTypes(ctx, [emailType])
    const email = this.extractGeneratedEmail(data)
    if (email) return email

    throw new Error(`Gmailnator did not return an email. Response: ${this.summarizeResponse(data)}`)
  }

  private async generateWithTypes(
    ctx: JobContext,
    types: string[]
  ): Promise<GmailnatorGenerateResponse> {
    return this.request<GmailnatorGenerateResponse>(ctx, '/emails/generate', {
      method: 'POST',
      body: JSON.stringify({ type: types })
    })
  }

  private extractGeneratedEmail(data: unknown): string | null {
    if (!data) return null
    if (typeof data === 'string') return data.includes('@') ? data : null
    if (Array.isArray(data)) {
      for (const item of data) {
        const email = this.extractGeneratedEmail(item)
        if (email) return email
      }
      return null
    }
    if (typeof data !== 'object') return null

    const record = data as Record<string, unknown>
    for (const key of ['email', 'address']) {
      const value = record[key]
      if (typeof value === 'string' && value.includes('@')) return value
    }

    for (const key of ['result', 'data', 'results', 'emails']) {
      const email = this.extractGeneratedEmail(record[key])
      if (email) return email
    }

    return null
  }

  private summarizeResponse(data: unknown): string {
    try {
      return JSON.stringify(data).slice(0, 500)
    } catch {
      return String(data).slice(0, 500)
    }
  }

  async listInbox(ctx: JobContext, email: string, limit = 10): Promise<GmailnatorInboxResponse> {
    const inboxEmail = this.normalizeGmailAddressForInbox(email)
    return this.listInboxOnce(ctx, inboxEmail, limit).catch((err) => {
      if (this.isNotFoundError(err)) {
        return { email: inboxEmail, messages: [], message_count: 0 } as GmailnatorInboxResponse
      }
      throw err
    })
  }

  private async listInboxOnce(
    ctx: JobContext,
    email: string,
    limit: number
  ): Promise<GmailnatorInboxResponse> {
    return this.request<GmailnatorInboxResponse>(ctx, '/inbox', {
      method: 'POST',
      body: JSON.stringify({ email, limit })
    })
  }

  normalizeGmailAddressForInbox(email: string): string {
    const [localPart, domainPart] = email.toLowerCase().split('@')
    if (!localPart || !domainPart) return email
    if (domainPart !== 'gmail.com' && domainPart !== 'googlemail.com') return email

    const baseLocal = localPart.split('+')[0].replace(/\./g, '')
    return `${baseLocal}@gmail.com`
  }

  private isNotFoundError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err)
    return message.includes('Gmailnator API error 404:')
  }

  async getMessage(ctx: JobContext, messageId: string): Promise<GmailnatorMessageResponse> {
    return this.request<GmailnatorMessageResponse>(ctx, `/inbox/${encodeURIComponent(messageId)}`, {
      method: 'GET'
    })
  }
}
