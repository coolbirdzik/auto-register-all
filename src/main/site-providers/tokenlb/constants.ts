export const DEFAULT_BASE_URL = 'https://tokenlb.net'

// TokenLB verification emails can contain a localized label before the code.
export const VERIFICATION_CODE_PATTERN = /验证码为[:：]?\s*([a-zA-Z0-9]{6})/

// The sign-up page is a React SPA and its markup has changed over time. Keep
// current selectors first and legacy selectors as fallbacks.
export const FORM_READY_SELECTORS = [
  'input[name="username"]',
  'input[placeholder="Enter your username"]',
  'input.semi-input[placeholder*="username" i]',
  'input[placeholder*="用户名"]',
  'input.semi-input[placeholder*="用户名"]'
] as const

export const FIELD_SELECTORS = {
  username: [
    'input[name="username"]',
    'input[placeholder="Enter your username"]',
    'input.semi-input[placeholder*="username" i]',
    'input[name="userName"]',
    '#username'
  ],
  password: [
    'input[name="password"]',
    'input[placeholder="Enter password (8-20 characters)"]',
    'input[placeholder*="Enter password" i]',
    'input.semi-input[placeholder*="Enter password" i]',
    '#password'
  ],
  password2: [
    'input[name="confirmPassword"]',
    'input[placeholder="Confirm password"]',
    'input[placeholder*="Confirm password" i]',
    'input.semi-input[placeholder*="Confirm password" i]',
    'input[name="password2"]',
    'input[name="confirm_password"]',
    '#password2'
  ],
  email: [
    'input[name="email"]',
    'input[placeholder="name@example.com"]',
    'input.semi-input[placeholder="name@example.com"]',
    'input[type="email"]',
    '#email'
  ],
  verificationCode: [
    'input[placeholder="Verification code"]',
    'input[placeholder*="Verification code" i]',
    'input.semi-input[placeholder*="Verification code" i]',
    'input[name="verification_code"]',
    'input[name="verificationCode"]',
    '#verification_code'
  ]
} as const

export const FIELD_PLACEHOLDERS = {
  username: ['enter your username', '用户名', 'username', 'user name'],
  password: ['enter password', '密码', 'password'],
  password2: ['confirm password', '确认密码', '再次输入', '再次', 'confirm', 'repeat'],
  email: ['name@example.com', '邮箱', '电子邮件', 'email', 'e-mail'],
  verificationCode: ['verification code', '验证码', 'verification', 'verify code', 'code']
} as const

export const BUTTON_TEXT = {
  getCode: [
    'Send code',
    'Send Code',
    '获取验证码',
    '发送验证码',
    '发送邮件验证码',
    'Get Code',
    'Get code',
    'Get Verification Code'
  ],
  submit: [
    'Create account',
    'Create Account',
    'Sign up',
    'Sign Up',
    '注册',
    '提交',
    'Register',
    'Submit'
  ]
} as const

export const TERMS_CHECKBOX_TEXT = [
  'Terms of Service',
  'terms of service',
  '服务条款',
  'I have read and agree'
] as const

export const RESULT_KEYWORDS = {
  success: ['注册成功', '成功', 'success', 'registered'],
  failure: [
    '失败',
    '错误',
    '已存在',
    '不正确',
    '无效',
    'error',
    'failed',
    'invalid',
    'incorrect',
    'already'
  ]
} as const

export const SUCCESS_PATHS = ['/login', '/sign-in', '/signin', '/token', '/console']
