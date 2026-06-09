import type { EmailMessage } from '../../../shared/contracts'

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const LABEL_PATTERN = /(?:验证码为|验证码是|验证码|verification code(?:\s+is)?)[:：]?\s*([a-zA-Z0-9]{4,8})/i
const ALNUM_TOKEN_PATTERN = /\b[a-z0-9]{6}\b/gi

export function extractVerificationCode(
  message: EmailMessage,
  pattern?: RegExp
): string | null {
  const text = `${message.subject ?? ''} ${message.text ?? ''} ${stripHtml(message.html ?? '')}`

  const labelMatch = text.match(LABEL_PATTERN)
  if (labelMatch?.[1]) return labelMatch[1]

  if (pattern) {
    const explicit = text.match(pattern)
    if (explicit) return explicit[1] ?? explicit[0]
  }

  const tokens = text.match(ALNUM_TOKEN_PATTERN) ?? []
  const alphanumeric = tokens.find((t) => /[0-9]/.test(t) && /[a-z]/i.test(t))
  if (alphanumeric) return alphanumeric

  const digitsOnly = tokens.find((t) => /^\d{6}$/.test(t))
  return digitsOnly ?? null
}
