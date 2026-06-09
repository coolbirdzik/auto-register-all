import type { JobContext } from '../../../shared/contracts/job-context'
import type { ProxyManager } from '../../proxy/proxy-manager'
import type {
  EmailnatorGenerateResponse,
  EmailnatorInboxResponse
} from './types'

const BASE_URL = 'https://www.emailnator.com'

interface EmailnatorSession {
  cookieHeader: string
  xsrfToken: string
}

function parseSetCookie(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/,(?=\s*[^;=]+=[^;]+)/g)
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean)
}

function getCookieValue(cookies: string[], name: string): string {
  const cookie = cookies.find((item) => item.startsWith(`${name}=`))
  return cookie ? cookie.slice(name.length + 1) : ''
}

function extractEmail(data: EmailnatorGenerateResponse): string | null {
  const email = data.email?.find((item) => item.includes('@'))
  return email ?? null
}

export class EmailnatorClient {
  private session?: EmailnatorSession

  constructor(private proxyManager: ProxyManager) {}

  private async getSession(ctx: JobContext): Promise<EmailnatorSession> {
    if (this.session) return this.session

    const dispatcher = this.proxyManager.createFetchDispatcher(ctx.proxy)
    const res = await fetch(`${BASE_URL}/`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${BASE_URL}/`
      },
      dispatcher,
      signal: ctx.abortSignal
    } as RequestInit)

    if (!res.ok) {
      throw new Error(`Emailnator session failed (${res.status})`)
    }

    const cookies = parseSetCookie(res.headers.get('set-cookie'))
    const xsrfToken = decodeURIComponent(getCookieValue(cookies, 'XSRF-TOKEN'))
    const cookieHeader = cookies.join('; ')
    if (!xsrfToken || !cookieHeader) {
      throw new Error('Emailnator session did not include CSRF cookies')
    }

    this.session = { cookieHeader, xsrfToken }
    return this.session
  }

  private async postText(ctx: JobContext, path: string, body: unknown): Promise<string> {
    const session = await this.getSession(ctx)
    const dispatcher = this.proxyManager.createFetchDispatcher(ctx.proxy)
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': session.xsrfToken,
        Cookie: session.cookieHeader,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`
      },
      body: JSON.stringify(body),
      dispatcher,
      signal: ctx.abortSignal
    } as RequestInit)

    if (!res.ok) {
      const text = await res.text()
      if (res.status === 419) {
        this.session = undefined
      }
      throw new Error(`Emailnator request failed (${res.status}): ${text.slice(0, 300)}`)
    }

    return res.text()
  }

  private async postJson<T>(ctx: JobContext, path: string, body: unknown): Promise<T> {
    const text = await this.postText(ctx, path, body)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`Emailnator returned non-JSON response: ${text.slice(0, 300)}`)
    }
  }

  async generate(ctx: JobContext, types: string[]): Promise<string> {
    const data = await this.postJson<EmailnatorGenerateResponse>(ctx, '/generate-email', {
      email: types
    })
    const email = extractEmail(data)
    if (!email) {
      throw new Error(`Emailnator did not return an email: ${JSON.stringify(data).slice(0, 300)}`)
    }
    return email
  }

  async listMessages(ctx: JobContext, email: string): Promise<EmailnatorInboxResponse> {
    return this.postJson<EmailnatorInboxResponse>(ctx, '/message-list', { email })
  }

  async getMessage(ctx: JobContext, email: string, messageID: string): Promise<string> {
    return this.postText(ctx, '/message-list', { email, messageID })
  }
}
