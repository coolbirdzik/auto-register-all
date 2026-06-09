import type { FreeProxySettings, FreeProxySource, ProxyConfig } from '../../shared/contracts'
import { parseProxyList } from './proxy-parser'

const PROXYSCRAPE_API_URL = 'https://api.proxyscrape.com/v4/free-proxy-list/get'

const SOURCE_URLS: Record<Exclude<FreeProxySource, 'proxyscrape'>, string> = {
  'speedx-http': 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  'monosans-http': 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
}

function normalizeCountry(country?: string): string {
  const normalized = String(country ?? 'vn')
    .trim()
    .toLowerCase()
  return /^[a-z]{2}$/.test(normalized) ? normalized : 'vn'
}

function resolveUrl(settings: FreeProxySettings): string {
  const source = settings.source ?? 'proxyscrape'
  if (source !== 'proxyscrape') return SOURCE_URLS[source]

  const params = new URLSearchParams({
    request: 'display_proxies',
    proxy_format: 'protocolipport',
    format: 'text',
    country: normalizeCountry(settings.country)
  })
  return `${PROXYSCRAPE_API_URL}?${params.toString()}`
}

export class FreeProxyClient {
  constructor(private settings: FreeProxySettings = {}) {}

  async importProxies(): Promise<ProxyConfig[]> {
    const res = await fetch(resolveUrl(this.settings), {
      headers: {
        accept: '*/*',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        referer: 'https://vi.proxyscrape.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(30000)
    } as RequestInit)

    if (!res.ok) {
      throw new Error(`Free proxy source returned HTTP ${res.status}`)
    }

    return parseProxyList(await res.text())
  }
}
