import { randomBytes } from 'crypto'

export function generatePassword(length = 16): string {
  const normalizedLength = Math.max(8, Math.min(128, Math.floor(length)))
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(normalizedLength)
  let password = ''
  for (let i = 0; i < normalizedLength; i++) {
    password += chars[bytes[i] % chars.length]
  }
  return password
}

export function generateUsernameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email
  return localPart || email
}
