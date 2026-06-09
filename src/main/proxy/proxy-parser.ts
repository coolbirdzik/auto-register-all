import { v4 as uuidv4 } from 'uuid'
import type { ProxyConfig, ProxyType } from '../../shared/contracts'

function makeLabel(host: string, port: number, type: ProxyType): string {
  return `${type}://${host}:${port}`
}

export function parseProxyLine(line: string): ProxyConfig | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  let type: ProxyType = 'http'
  let rest = trimmed

  const schemeMatch = /^(https?|socks5):\/\//i.exec(trimmed)
  if (schemeMatch) {
    type = schemeMatch[1].toLowerCase() as ProxyType
    rest = trimmed.slice(schemeMatch[0].length)
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return null
  }

  if (type === 'socks5') {
    return null
  }

  let username: string | undefined
  let password: string | undefined
  let host: string
  let port: number

  const atIdx = rest.lastIndexOf('@')
  if (atIdx !== -1) {
    const auth = rest.slice(0, atIdx)
    rest = rest.slice(atIdx + 1)
    const colonIdx = auth.indexOf(':')
    if (colonIdx !== -1) {
      username = decodeURIComponent(auth.slice(0, colonIdx))
      password = decodeURIComponent(auth.slice(colonIdx + 1))
    } else {
      username = decodeURIComponent(auth)
    }
  } else {
    const parts = rest.split(':')
    if (parts.length === 4) {
      rest = `${parts[0]}:${parts[1]}`
      username = parts[2]
      password = parts[3]
    }
  }

  const colonIdx = rest.lastIndexOf(':')
  if (colonIdx === -1) return null

  host = rest.slice(0, colonIdx)
  const portStr = rest.slice(colonIdx + 1)
  port = parseInt(portStr, 10)
  if (!host || isNaN(port)) return null

  return {
    id: uuidv4(),
    label: makeLabel(host, port, type),
    type,
    host,
    port,
    username,
    password
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProxyObject(value: Record<string, unknown>): ProxyConfig | null {
  const proxyText = value.proxy ?? value.url ?? value.address
  if (typeof proxyText === 'string') return parseProxyLine(proxyText)

  const typeValue = String(value.type ?? value.protocol ?? 'http').toLowerCase()
  if (typeValue !== 'http' && typeValue !== 'https') return null

  const host = String(value.host ?? value.ip ?? value.hostname ?? '').trim()
  const port = Number(value.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null

  const username = value.username ?? value.user
  const password = value.password ?? value.pass
  const label = String(value.label ?? makeLabel(host, port, typeValue)).trim()

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : uuidv4(),
    label: label || makeLabel(host, port, typeValue),
    type: typeValue,
    host,
    port,
    username: typeof username === 'string' && username.trim() ? username : undefined,
    password: typeof password === 'string' ? password : undefined,
    bypass: typeof value.bypass === 'string' && value.bypass.trim() ? value.bypass : undefined
  }
}

function parseProxyJson(value: unknown): ProxyConfig[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return parseProxyLine(item)
        if (isPlainObject(item)) return parseProxyObject(item)
        return null
      })
      .filter((proxy): proxy is ProxyConfig => proxy !== null)
  }

  if (isPlainObject(value)) {
    const nested = value.proxies ?? value.items ?? value.data
    if (Array.isArray(nested)) return parseProxyJson(nested)
    const proxy = parseProxyObject(value)
    return proxy ? [proxy] : []
  }

  return []
}

export function parseProxyList(text: string): ProxyConfig[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parseProxyJson(parsed)
  } catch {
    // Fall through to line-based parsing for TXT and pasted lists.
  }

  return text
    .split(/\r?\n/)
    .map(parseProxyLine)
    .filter((p): p is ProxyConfig => p !== null)
}
