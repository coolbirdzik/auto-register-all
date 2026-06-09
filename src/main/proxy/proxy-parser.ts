import { v4 as uuidv4 } from 'uuid'
import type { ProxyConfig, ProxyType } from '../../shared/contracts'

function makeLabel(host: string, port: number, type: ProxyType): string {
  return `${type}://${host}:${port}`
}

export function parseProxyLine(line: string): ProxyConfig | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (/^socks5:\/\//i.test(trimmed)) return null

  let type: ProxyType = 'http'
  let rest = trimmed

  const schemeMatch = /^(https?|socks5):\/\//i.exec(trimmed)
  if (schemeMatch) {
    type = schemeMatch[1].toLowerCase() as ProxyType
    rest = trimmed.slice(schemeMatch[0].length)
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

export function parseProxyList(text: string): ProxyConfig[] {
  return text
    .split(/\r?\n/)
    .map(parseProxyLine)
    .filter((p): p is ProxyConfig => p !== null)
}
