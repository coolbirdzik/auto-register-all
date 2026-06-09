import { BrowserWindow, session as electronSession } from 'electron'
import type { JobContext } from '../../../shared/contracts/job-context'
import type { ProxyManager } from '../../proxy/proxy-manager'
import type {
  EmailnatorGenerateResponse,
  EmailnatorInboxResponse
} from './types'

const BASE_URL = 'https://www.emailnator.com'

function buildInboxUrl(email: string): string {
  return `${BASE_URL}/mailbox/#${email}`
}

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
  private previewWindow?: BrowserWindow

  constructor(private proxyManager: ProxyManager) {}

  private async updatePreview(ctx: JobContext, status: string): Promise<void> {
    if (ctx.headless) return

    if (!this.previewWindow || this.previewWindow.isDestroyed()) {
      const partition = `emailnator-preview:${ctx.jobId}`
      const ses = electronSession.fromPartition(partition)
      if (ctx.proxy) {
        await this.proxyManager.applyToSession(ses, ctx.proxy)
      }
      this.previewWindow = new BrowserWindow({
        show: true,
        width: 960,
        height: 720,
        title: 'Emailnator Preview',
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      await this.previewWindow.loadURL(BASE_URL)
    }

    this.previewWindow.show()
    const script = `(() => {
      const id = 'auto-register-emailnator-status';
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:12px 14px;border-radius:10px;background:#111827;color:#f9fafb;font:13px ui-monospace,monospace;box-shadow:0 10px 30px rgba(0,0,0,.25);white-space:pre-wrap;';
        document.body.appendChild(el);
      }
      el.textContent = ${JSON.stringify(status)};
      document.title = 'Emailnator Preview - ' + ${JSON.stringify(status)}.slice(0, 60);
    })()`
    await this.previewWindow.webContents.executeJavaScript(script, true).catch(() => undefined)
  }

  private async ensurePreviewWindow(ctx: JobContext): Promise<BrowserWindow> {
    await this.updatePreview(ctx, 'Opening Emailnator...')
    if (!this.previewWindow || this.previewWindow.isDestroyed()) {
      throw new Error('Emailnator preview window was not created')
    }
    return this.previewWindow
  }

  private async getSession(ctx: JobContext): Promise<EmailnatorSession> {
    if (this.session) return this.session

    await this.updatePreview(ctx, 'Opening Emailnator...')

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
    await this.updatePreview(ctx, 'Emailnator session ready')
    return this.session
  }

  private async postText(ctx: JobContext, path: string, body: unknown): Promise<string> {
    if (!ctx.headless) {
      return this.postTextFromPage(ctx, path, body)
    }

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

  private async postTextFromPage(ctx: JobContext, path: string, body: unknown): Promise<string> {
    const win = await this.ensurePreviewWindow(ctx)
    const result = await win.webContents.executeJavaScript(
      `new Promise(async (resolve) => {
        const getCookie = (name) => {
          const item = document.cookie.split('; ').find((part) => part.startsWith(name + '='));
          return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
        };
        try {
          const xsrf = getCookie('XSRF-TOKEN');
          const res = await window.fetch(${JSON.stringify(path)}, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {})
            },
            body: ${JSON.stringify(JSON.stringify(body))}
          });
          const text = await res.text();
          resolve({ ok: res.ok, status: res.status, text });
        } catch (err) {
          resolve({ ok: false, status: 0, text: String(err) });
        }
      })`,
      true
    ) as { ok: boolean; status: number; text: string }

    if (!result.ok) {
      throw new Error(`Emailnator page request failed (${result.status}): ${result.text.slice(0, 300)}`)
    }
    return result.text
  }

  private async openInboxPage(ctx: JobContext, email: string): Promise<void> {
    if (ctx.headless) return
    const win = await this.ensurePreviewWindow(ctx)
    const inboxUrl = buildInboxUrl(email)
    if (win.webContents.getURL() !== inboxUrl) {
      await win.loadURL(inboxUrl).catch(() => undefined)
    }
    await win.webContents.executeJavaScript(
      `(() => {
        const id = 'auto-register-emailnator-inbox';
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('section');
          el.id = id;
          el.style.cssText = 'max-width:980px;margin:28px auto;padding:18px;border:1px solid #d1d5db;border-radius:14px;background:#fff;color:#111827;font:14px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.08);';
          const root = document.getElementById('root') || document.body;
          root.prepend(el);
        }
        el.innerHTML = '<h2 style="margin:0 0 8px;font-size:20px">Inbox</h2>' +
          '<div style="font-family:ui-monospace,monospace;margin-bottom:12px">' + ${JSON.stringify(email)} + '</div>' +
          '<div id="auto-register-emailnator-messages" style="color:#6b7280">Waiting for messages...</div>';
        document.title = 'Inbox - ' + ${JSON.stringify(email)};
      })()`,
      true
    ).catch(() => undefined)
  }

  async validateInbox(ctx: JobContext, email: string): Promise<boolean> {
    if (!ctx.headless) {
      await this.openInboxPage(ctx, email)
      if (!this.previewWindow || this.previewWindow.isDestroyed()) return false
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const text = await this.previewWindow.webContents.executeJavaScript('document.body.innerText || ""', true)
      return !String(text).toLowerCase().includes('email is currently not available')
    }

    const partition = `emailnator-validate:${ctx.jobId}:${encodeURIComponent(email)}`
    const ses = electronSession.fromPartition(partition)
    if (ctx.proxy) {
      await this.proxyManager.applyToSession(ses, ctx.proxy)
    }
    const win = new BrowserWindow({
      show: !ctx.headless,
      width: 960,
      height: 720,
      title: 'Emailnator Inbox Validation',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    try {
      await win.loadURL(buildInboxUrl(email))
      await new Promise((resolve) => setTimeout(resolve, 4000))
      const text = await win.webContents.executeJavaScript('document.body.innerText || ""', true)
      return !String(text).toLowerCase().includes('email is currently not available')
    } finally {
      if (ctx.headless && !win.isDestroyed()) win.destroy()
    }
  }

  private async renderInboxMessages(ctx: JobContext, email: string, inbox: EmailnatorInboxResponse): Promise<void> {
    if (ctx.headless || !this.previewWindow || this.previewWindow.isDestroyed()) return
    await this.previewWindow.webContents.executeJavaScript(
      `(() => {
        const host = document.getElementById('auto-register-emailnator-messages');
        if (!host) return;
        const messages = ${JSON.stringify(inbox.messageData ?? [])};
        if (messages.length === 0) {
          host.innerHTML = '<div style="color:#6b7280">No messages yet for ${email.replace(/'/g, '&#39;')}</div>';
          return;
        }
        host.innerHTML = messages.map((m) => '<div style="padding:10px 0;border-top:1px solid #e5e7eb">' +
          '<div><b>' + String(m.subject || '') + '</b></div>' +
          '<div style="color:#6b7280">From: ' + String(m.from || '') + '</div>' +
          '<div style="color:#6b7280">Time: ' + String(m.time || '') + '</div>' +
          '</div>').join('');
      })()`,
      true
    ).catch(() => undefined)
  }

  private async renderMessageHtml(ctx: JobContext, html: string): Promise<void> {
    if (ctx.headless || !this.previewWindow || this.previewWindow.isDestroyed()) return
    await this.previewWindow.webContents.executeJavaScript(
      `(() => {
        const host = document.getElementById('auto-register-emailnator-messages');
        if (!host) return;
        host.innerHTML = '<h3 style="margin:12px 0">Message</h3><iframe id="auto-register-emailnator-message-frame" style="width:100%;min-height:420px;border:1px solid #e5e7eb;border-radius:10px;background:white"></iframe>';
        const frame = document.getElementById('auto-register-emailnator-message-frame');
        frame.srcdoc = ${JSON.stringify(html)};
      })()`,
      true
    ).catch(() => undefined)
  }

  private async reloadInboxPage(ctx: JobContext, email: string): Promise<void> {
    if (ctx.headless || !this.previewWindow || this.previewWindow.isDestroyed()) return
    await this.previewWindow.loadURL(buildInboxUrl(email)).catch(() => undefined)
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
    await this.updatePreview(ctx, `Generating email...\nTypes: ${types.join(', ')}`)
    const data = await this.postJson<EmailnatorGenerateResponse>(ctx, '/generate-email', {
      email: types
    })
    const email = extractEmail(data)
    if (!email) {
      throw new Error(`Emailnator did not return an email: ${JSON.stringify(data).slice(0, 300)}`)
    }
    await this.updatePreview(ctx, `Generated email:\n${email}`)
    await this.openInboxPage(ctx, email)
    return email
  }

  async listMessages(ctx: JobContext, email: string): Promise<EmailnatorInboxResponse> {
    await this.openInboxPage(ctx, email)
    await this.reloadInboxPage(ctx, email)
    await this.updatePreview(ctx, `Checking inbox:\n${email}`)
    const inbox = await this.postJson<EmailnatorInboxResponse>(ctx, '/message-list', { email })
    await this.renderInboxMessages(ctx, email, inbox)
    await this.updatePreview(ctx, `Inbox checked:\n${email}\nMessages: ${inbox.messageData?.length ?? 0}`)
    return inbox
  }

  async getMessage(ctx: JobContext, email: string, messageID: string): Promise<string> {
    await this.updatePreview(ctx, `Opening message:\n${email}\nMessage ID: ${messageID}`)
    const html = await this.postText(ctx, '/message-list', { email, messageID })
    await this.renderMessageHtml(ctx, html)
    await this.updatePreview(ctx, `Message loaded:\n${email}\nMessage ID: ${messageID}`)
    return html
  }
}
