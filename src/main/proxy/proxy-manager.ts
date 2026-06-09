import type { Session } from 'electron'
import { ProxyAgent, type Dispatcher } from 'undici'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { ProxyConfig } from '../../shared/contracts'

export function isBrowserSupportedProxy(proxy: ProxyConfig): boolean {
  return proxy.type !== 'socks5'
}

export function buildProxyRules(p: ProxyConfig): string {
  if (p.type === 'direct') return 'direct://'
  return `${p.type}://${p.host}:${p.port}`
}

export function formatProxyUrl(p: ProxyConfig): string {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@` : ''
  return `${p.type}://${auth}${p.host}:${p.port}`
}

export class ProxyManager {
  private proxies: ProxyConfig[] = []
  private roundRobinIndex = 0

  setProxies(proxies: ProxyConfig[]): void {
    this.proxies = proxies.filter(isBrowserSupportedProxy)
  }

  add(proxy: ProxyConfig): boolean {
    if (!isBrowserSupportedProxy(proxy)) return false
    this.proxies.push(proxy)
    return true
  }

  remove(id: string): void {
    this.proxies = this.proxies.filter((p) => p.id !== id)
  }

  list(): ProxyConfig[] {
    return [...this.proxies]
  }

  get(id: string): ProxyConfig | undefined {
    return this.proxies.find((p) => p.id === id)
  }

  getByHost(host: string): ProxyConfig | undefined {
    return this.proxies.find((p) => p.host === host)
  }

  getByEndpoint(host: string, port?: number): ProxyConfig | undefined {
    return this.proxies.find((p) => p.host === host && (!port || p.port === port))
  }

  async applyToSession(electronSession: Session, proxy: ProxyConfig): Promise<void> {
    if (proxy.type === 'direct') {
      await electronSession.setProxy({ mode: 'direct' })
      await electronSession.closeAllConnections()
      return
    }
    await electronSession.setProxy({
      proxyRules: buildProxyRules(proxy),
      proxyBypassRules: proxy.bypass ?? '<local>'
    })
    await electronSession.closeAllConnections()
  }

  createFetchDispatcher(proxy?: ProxyConfig): Dispatcher | undefined {
    if (!proxy || proxy.type === 'direct') return undefined
    const url = formatProxyUrl(proxy)
    if (proxy.type === 'socks5') {
      return new SocksProxyAgent(url) as unknown as Dispatcher
    }
    return new ProxyAgent(url)
  }

  async test(proxy: ProxyConfig): Promise<{
    ok: boolean
    ip?: string
    latencyMs: number
    error?: string
  }> {
    const start = Date.now()
    try {
      const dispatcher = this.createFetchDispatcher(proxy)
      const res = await fetch('https://api.ipify.org?format=json', {
        dispatcher,
        signal: AbortSignal.timeout(15000)
      } as RequestInit)
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` }
      }
      const data = (await res.json()) as { ip?: string }
      return { ok: true, ip: data.ip, latencyMs: Date.now() - start }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  next(strategy: 'round-robin' | 'random' = 'round-robin'): ProxyConfig | undefined {
    if (this.proxies.length === 0) return undefined
    if (strategy === 'random') {
      return this.proxies[Math.floor(Math.random() * this.proxies.length)]
    }
    const proxy = this.proxies[this.roundRobinIndex % this.proxies.length]
    this.roundRobinIndex++
    return proxy
  }

  nextFromPool(ids: string[], index: number): ProxyConfig | undefined {
    if (ids.length === 0) return undefined
    const id = ids[index % ids.length]
    return this.get(id)
  }
}
