import type { JobContext } from './job-context'
import type {
  ConfigField,
  CreateInboxOptions,
  EmailMessage,
  Inbox,
  MessageFilter
} from './types'

export interface EmailProvider {
  readonly id: string
  readonly name: string

  getConfigSchema(): ConfigField[]
  validateConfig(config: Record<string, unknown>): Promise<boolean>
  createInbox(ctx: JobContext, options?: CreateInboxOptions): Promise<Inbox>
  validateInbox?(ctx: JobContext, inbox: Inbox): Promise<boolean>
  waitForMessage(
    ctx: JobContext,
    inbox: Inbox,
    filter: MessageFilter,
    timeoutMs: number
  ): Promise<EmailMessage>
  extractCode?(message: EmailMessage, pattern?: RegExp): string | null
}
