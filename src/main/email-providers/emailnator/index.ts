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
import { extractVerificationCode } from '../gmailnator/parser'
import { EmailnatorClient } from './client'
import type { EmailnatorMessageListItem } from './types'

const INITIAL_INBOX_WAIT_MS = 10000
const INBOX_POLL_INTERVAL_MS = 10000
const VISIBLE_INITIAL_INBOX_WAIT_MS = 2500
const VISIBLE_INBOX_POLL_INTERVAL_MS = 3000
const MAX_INBOX_POLLS = 3
const VISIBLE_MAX_INBOX_POLLS = 20
const DEFAULT_EMAIL_TYPES = ['plusGmail', 'dotGmail', 'googleMail']
const ALLOWED_EMAIL_TYPES = new Set(DEFAULT_EMAIL_TYPES)

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

function splitTypes(value: unknown): string[] {
  const text = String(value ?? '').trim()
  if (!text) return DEFAULT_EMAIL_TYPES
  const types = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ALLOWED_EMAIL_TYPES.has(item))
    .filter(Boolean)
  return types.length > 0 ? types : DEFAULT_EMAIL_TYPES
}

function matchesFilter(item: EmailnatorMessageListItem, filter: MessageFilter): boolean {
  if (filter.subjectIncludes && !item.subject.toLowerCase().includes(filter.subjectIncludes.toLowerCase())) {
    return false
  }
  if (filter.fromIncludes && !item.from.toLowerCase().includes(filter.fromIncludes.toLowerCase())) {
    return false
  }
  return true
}

export class EmailnatorProvider implements EmailProvider {
  readonly id = 'emailnator'
  readonly name = 'Emailnator (HTML)'

  private client: EmailnatorClient

  constructor(proxyManager: ProxyManager) {
    this.client = new EmailnatorClient(proxyManager)
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'emailTypes',
        label: 'Gmail Types',
        type: 'text',
        default: DEFAULT_EMAIL_TYPES.join(', ')
      }
    ]
  }

  async validateConfig(): Promise<boolean> {
    return true
  }

  async createInbox(ctx: JobContext, _options?: CreateInboxOptions): Promise<Inbox> {
    const config = ctx.settings.emailProviders.emailnator ?? {}
    const emailTypes = splitTypes(config.emailTypes)
    const email = await this.client.generate(ctx, emailTypes)

    return {
      id: email,
      address: email,
      providerId: this.id,
      createdAt: new Date().toISOString()
    }
  }

  async validateInbox(ctx: JobContext, inbox: Inbox): Promise<boolean> {
    return this.client.validateInbox(ctx, inbox.address)
  }

  async waitForMessage(
    ctx: JobContext,
    inbox: Inbox,
    filter: MessageFilter,
    timeoutMs: number
  ): Promise<EmailMessage> {
    const deadline = Date.now() + timeoutMs
    const initialWaitMs = ctx.headless ? INITIAL_INBOX_WAIT_MS : VISIBLE_INITIAL_INBOX_WAIT_MS
    const pollIntervalMs = ctx.headless ? INBOX_POLL_INTERVAL_MS : VISIBLE_INBOX_POLL_INTERVAL_MS
    const maxPolls = ctx.headless ? MAX_INBOX_POLLS : VISIBLE_MAX_INBOX_POLLS
    await delay(Math.min(initialWaitMs, timeoutMs), ctx.abortSignal)

    let pollCount = 0
    while (Date.now() < deadline && pollCount < maxPolls) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')
      pollCount++

      const list = await this.client.listMessages(ctx, inbox.address)
      const messages = list.messageData ?? []
      const item = messages.find((message) => matchesFilter(message, filter))
      if (item) {
        const html = await this.client.getMessage(ctx, inbox.address, item.messageID)
        return {
          id: item.messageID,
          subject: item.subject,
          from: item.from,
          date: item.time ?? '',
          html,
          text: html
        }
      }

      if (pollCount < maxPolls) {
        await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), ctx.abortSignal)
      }
    }

    throw new Error(`Emailnator message timeout after ${maxPolls} inbox check(s)`)
  }

  extractCode(message: EmailMessage, pattern?: RegExp): string | null {
    return extractVerificationCode(message, pattern)
  }
}
