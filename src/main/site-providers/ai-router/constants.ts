export const DEFAULT_BASE_URL = 'https://ai-router.dev'
export const DEFAULT_API_BASE_URL = 'https://api.ai-router.dev/api/v1'
export const DEFAULT_REGISTER_PATH = '/register'
export const DEFAULT_LOGIN_PATH = '/login'

export const VERIFICATION_CODE_PATTERN =
  /(?:your verification code is:\s*|verification code is:\s*|code is:\s*)(\d{6})/i

export const FIELD_SELECTORS = {
  email: ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'],
  password: ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="password" i]'],
  verificationCode: [
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[maxlength="6"]',
    'input[name="code"]',
    '#code'
  ]
} as const

export const FIELD_PLACEHOLDERS = {
  email: ['email', 'e-mail', 'mail'],
  password: ['password'],
  verificationCode: ['verification code', 'verify code', 'code', '000000']
} as const

export const BUTTON_TEXT = {
  register: ['Create Account', 'Create account', 'Register', 'Sign up', 'Sign Up', 'Continue'],
  sendCode: ['Send Code', 'Resend Code', 'Click to resend'],
  verify: ['Verify and Create', 'Verify & Create', 'Verify and create', 'Verify']
} as const

export const EMAIL_FILTER = {
  subjectIncludes: 'verification code'
} as const

export const RESULT_KEYWORDS = {
  success: ['success', 'created', 'verified', 'complete', 'welcome'],
  failure: ['error', 'failed', 'invalid', 'incorrect', 'already', 'expired', 'unavailable']
} as const

export const SUCCESS_PATHS = ['/dashboard', '/profile', '/keys', '/usage', '/subscriptions'] as const
export const VERIFY_PATHS = ['/email-verify'] as const
