import type { ProxyConfig } from './types'

export interface BrowserSession {
  readonly profileId: string
  readonly partition: string
  readonly proxy?: ProxyConfig

  navigate(url: string, options?: { timeoutMs?: number }): Promise<void>
  executeScript<T>(script: string | (() => T)): Promise<T>
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>
  show(): void
  hide(): void
  destroy(): void
}
