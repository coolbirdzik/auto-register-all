import { randomBytes } from 'crypto'

export function generateUsername(prefix = 'user'): string {
  const suffix = randomBytes(4).toString('hex')
  return `${prefix}_${suffix}`
}

export function generateUsernameFromEmail(email: string, fallbackPrefix = 'user'): string {
  const localPart = email.split('@')[0] ?? ''
  const plusBase = localPart.split('+')[0] ?? localPart
  const normalized = plusBase.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
  if (normalized.length >= 3) return normalized
  return generateUsername(fallbackPrefix).slice(0, 20)
}

export function generatePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(length)
  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length]
  }
  return password
}
