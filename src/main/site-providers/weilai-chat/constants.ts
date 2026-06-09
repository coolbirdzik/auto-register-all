export const DEFAULT_BASE_URL = 'https://api.weilai.chat'
export const DEFAULT_REGISTER_PATH = '/register'

export const VERIFICATION_CODE_PATTERN = /(?:your verification code is:\s*|verification code is:\s*|code is:\s*)(\d{6})/i

export const FORM_READY_SELECTORS = [
  'form',
  'input[type="email"]',
  'input[name="email"]',
  'input[placeholder*="email" i]',
  'input[type="password"]'
] as const

export const FIELD_SELECTORS = {
  email: ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'],
  password: ['input[type="password"]', 'input[name="password"]', 'input[placeholder*="password" i]'],
  confirmPassword: [
    'input[name="confirmPassword"]',
    'input[name="password_confirmation"]',
    'input[placeholder*="confirm" i]',
    'input[placeholder*="repeat" i]'
  ],
  verificationCode: [
    '#code',
    'input#code',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[maxlength="6"]',
    'input[placeholder="000000"]'
  ]
} as const

export const FIELD_PLACEHOLDERS = {
  email: ['email', 'e-mail', 'mail'],
  password: ['password'],
  confirmPassword: ['confirm', 'repeat', 'password confirmation'],
  verificationCode: ['000000', 'verification code', 'verify code', 'code']
} as const

export const BUTTON_TEXT = {
  register: ['Register', 'Create Account', 'Sign up', 'Sign Up', 'Continue'],
  verify: ['Verify & Create Account', 'Verify', 'Create Account']
} as const

export const TERMS_CHECKBOX_TEXT = ['agree', 'terms', 'privacy', 'I agree', '同意', '我已阅读并同意'] as const

export const EMAIL_FILTER = {
  subjectIncludes: 'Email verification code'
} as const

export const RESULT_KEYWORDS = {
  success: ['success', 'successful', 'created', 'account created', 'verified', 'complete'],
  failure: ['error', 'failed', 'invalid', 'incorrect', 'already', 'expired', 'unavailable']
} as const

export const SUCCESS_PATHS = ['/profile', '/dashboard', '/console', '/token', '/account'] as const
