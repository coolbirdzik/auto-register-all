import type { EmailProvider } from '../../../shared/contracts'
import type { JobContext } from '../../../shared/contracts/job-context'
import type {
  ConfigField,
  CreateInboxOptions,
  EmailMessage,
  Inbox,
  MessageFilter
} from '../../../shared/contracts'
import type { ProxyManager } from '../../proxy/proxy-manager'
import { GmailnatorClient } from './client'
import { extractVerificationCode } from './parser'

const INITIAL_INBOX_WAIT_MS = 20000
const INBOX_POLL_INTERVAL_MS = 25000
const INBOX_LIST_LIMIT = 5
const MAX_INBOX_POLLS = 3

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Job cancelled'))

    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Job cancelled'))
      },
      { once: true }
    )
  })
}

export class GmailnatorProvider implements EmailProvider {
  readonly id = 'gmailnator'
  readonly name = 'Gmailnator (RapidAPI)'

  private client: GmailnatorClient

  constructor(proxyManager: ProxyManager) {
    this.client = new GmailnatorClient(proxyManager)
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'customEmail',
        label: 'Custom Email (manual OTP)',
        type: 'text',
        required: false
      },
      { key: 'apiKey', label: 'RapidAPI Key', type: 'text', required: true },
      {
        key: 'emailType',
        label: 'Email Type',
        type: 'select',
        options: [
          'public_gmail_plus',
          'public_gmail_dot',
          'public_googlemail',
          'private_gmail_plus',
          'private_gmail_dot',
          'private_googlemail'
        ],
        default: 'public_gmail_plus'
      }
    ]
  }

  async validateConfig(config: Record<string, unknown>): Promise<boolean> {
    return Boolean(
      String(config.customEmail ?? '').trim() ||
        (config.apiKey && String(config.apiKey).length > 0)
    )
  }

  async createInbox(ctx: JobContext, _options?: CreateInboxOptions): Promise<Inbox> {
    const customEmail = String(ctx.customEmail ?? ctx.settings.emailProviders.gmailnator?.customEmail ?? '').trim()
    if (customEmail) {
      return {
        id: customEmail,
        address: customEmail,
        providerId: this.id,
        createdAt: new Date().toISOString(),
        metadata: { manual: true }
      }
    }

    const email = await this.client.generate(ctx)
    return {
      id: email,
      address: email,
      providerId: this.id,
      createdAt: new Date().toISOString(),
      metadata: {
        inboxAddress: this.client.normalizeGmailAddressForInbox(email)
      }
    }
  }

  async waitForMessage(
    ctx: JobContext,
    inbox: Inbox,
    filter: MessageFilter,
    timeoutMs: number
  ): Promise<EmailMessage> {
    const deadline = Date.now() + timeoutMs
    const inboxAddress = String(inbox.metadata?.inboxAddress ?? inbox.address)

    await delay(Math.min(INITIAL_INBOX_WAIT_MS, timeoutMs), ctx.abortSignal)

    let pollCount = 0
    while (Date.now() < deadline && pollCount < MAX_INBOX_POLLS) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')

      pollCount++
      const inboxData = await this.client.listInbox(ctx, inboxAddress, INBOX_LIST_LIMIT)
      const messages = inboxData.messages ?? []

      for (const item of messages) {
        if (filter.subjectIncludes) {
          const subj = item.subject.toLowerCase()
          if (!subj.includes(filter.subjectIncludes.toLowerCase())) continue
        }
        if (filter.fromIncludes) {
          const from = item.from.toLowerCase()
          if (!from.includes(filter.fromIncludes.toLowerCase())) continue
        }

        const inlineContent = item.content ?? item.html ?? item.text
        const full = inlineContent
          ? {
              id: item.id,
              subject: item.subject,
              from: item.from,
              timestamp: item.timestamp,
              time_ago: item.time_ago,
              content: inlineContent
            }
          : await this.client.getMessage(ctx, item.id)
        const timestamp = full.timestamp ?? item.timestamp
        return {
          id: item.id,
          subject: full.subject ?? item.subject,
          from: full.from ?? item.from,
          date: timestamp ? new Date(timestamp * 1000).toISOString() : full.time_ago ?? item.time_ago ?? '',
          html: full.content,
          text: full.content
        }
      }

      if (pollCount < MAX_INBOX_POLLS) {
        await delay(Math.min(INBOX_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())), ctx.abortSignal)
      }
    }

    throw new Error(`Email message timeout after ${MAX_INBOX_POLLS} Gmailnator inbox check(s)`)
  }

  extractCode(message: EmailMessage, pattern?: RegExp): string | null {
    return extractVerificationCode(message, pattern)
  }
}
