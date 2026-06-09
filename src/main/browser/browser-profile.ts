import { v4 as uuidv4 } from 'uuid'
import type { BrowserProfile } from '../../shared/contracts'

export function createBrowserProfile(config: Partial<BrowserProfile> = {}): BrowserProfile {
  const id = config.id ?? uuidv4()
  return {
    id,
    label: config.label ?? 'Browser',
    partition: config.partition ?? `persist:profile-${id}`,
    proxyId: config.proxyId,
    userAgent: config.userAgent,
    visible: config.visible ?? false,
    createdAt: config.createdAt ?? new Date().toISOString()
  }
}
