import type { BrowserSession } from './browser-session'
import type { AppSettings, LogLevel, ManualOtpRequest, ProxyConfig } from './types'

export type ManualOtpRequester = (
  request: Omit<ManualOtpRequest, 'requestId'>
) => Promise<string>

export interface JobContext {
  jobId: string
  siteId: string
  emailProviderId: string
  browser: BrowserSession
  proxy?: ProxyConfig
  customEmail?: string
  settings: AppSettings
  headless: boolean
  requestManualOtp?: ManualOtpRequester
  log: (level: LogLevel, message: string) => void
  abortSignal: AbortSignal
}
