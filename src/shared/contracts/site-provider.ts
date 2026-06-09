import type { JobContext } from './job-context'
import type { ConfigField, RegisterOptions, RegisterResult, SiteStatus } from './types'

export interface SiteProvider {
  readonly id: string
  readonly name: string
  readonly baseUrl: string

  getConfigSchema(): ConfigField[]
  checkStatus?(ctx: JobContext): Promise<SiteStatus>
  register(ctx: JobContext, options: RegisterOptions): Promise<RegisterResult>
}
