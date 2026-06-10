import type { ProxyConfig } from './types'

export interface BrowserCookieSnapshot {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

export interface BrowserSession {
  readonly profileId: string
  readonly partition: string
  readonly proxy?: ProxyConfig

  navigate(url: string, options?: { timeoutMs?: number }): Promise<void>
  executeScript<T>(script: string | (() => T)): Promise<T>
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>
  clearStorage(): Promise<void>
  getCookies(url: string): Promise<BrowserCookieSnapshot[]>
  show(): void
  hide(): void
  destroy(): void
}
