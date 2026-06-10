import type {
  ConfigField,
  EmailMessage,
  EmailProvider,
  Inbox,
  RegisterOptions,
  RegisterResult,
  SiteProvider,
  SiteStatus
} from '../../../shared/contracts'
import type { JobContext } from '../../../shared/contracts/job-context'
import { CloakSession } from '../../browser/cloak-session'
import { FormDriver } from '../../browser/form-driver'
import type { ProviderRegistry } from '../../core/registry'
import type { ProxyManager } from '../../proxy/proxy-manager'
import type { ProxyConfig } from '../../../shared/contracts'
import {
  BUTTON_TEXT,
  DEFAULT_API_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_LOGIN_PATH,
  DEFAULT_REGISTER_PATH,
  EMAIL_FILTER,
  FIELD_PLACEHOLDERS,
  FIELD_SELECTORS,
  RESULT_KEYWORDS,
  SUCCESS_PATHS,
  VERIFICATION_CODE_PATTERN,
  VERIFY_PATHS
} from './constants'
import { generatePassword, generateUsernameFromEmail } from './credentials'

const FIELD_STEP_DELAY_MS = 400
const MAX_INBOX_ATTEMPTS = 5
const OTP_TIMEOUT_MS = 120_000

interface AiRouterPublicSettings {
  registration_enabled?: boolean
  email_verify_enabled?: boolean
  turnstile_enabled?: boolean
  turnstile_site_key?: string
  site_name?: string
  [key: string]: unknown
}

interface WrappedResponse<T> {
  code?: number
  message?: string
  data?: T
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Job cancelled'))

    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Job cancelled'))
      },
      { once: true }
    )
  })
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/api/v1')) return trimmed
  if (trimmed.endsWith('/api')) return `${trimmed}/v1`
  return `${trimmed}/api/v1`
}

export class AiRouterProvider implements SiteProvider {
  readonly id = 'ai-router'
  readonly name = 'AI-ROUTER'
  readonly baseUrl = DEFAULT_BASE_URL

  constructor(
    private registry: ProviderRegistry,
    private proxyManager: ProxyManager
  ) {}

  getConfigSchema(): ConfigField[] {
    return [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: DEFAULT_BASE_URL },
      { key: 'apiBaseUrl', label: 'API Base URL', type: 'text', default: DEFAULT_API_BASE_URL },
      { key: 'registerPath', label: 'Register Path', type: 'text', default: DEFAULT_REGISTER_PATH },
      { key: 'loginPath', label: 'Login Path', type: 'text', default: DEFAULT_LOGIN_PATH },
      { key: 'passwordLength', label: 'Password Length', type: 'number', default: 16 },
      { key: 'interStepDelayMs', label: 'Delay between steps (ms)', type: 'number', default: 800 }
    ]
  }

  async checkStatus(ctx: JobContext): Promise<SiteStatus> {
    try {
      const rawApiBaseUrl = String(ctx.settings.siteConfigs[this.id]?.apiBaseUrl ?? DEFAULT_API_BASE_URL)
      const apiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl)
      const settings = await this.fetchPublicSettings(apiBaseUrl, ctx.proxy)
      if (settings.registration_enabled === false) {
        return { ok: false, message: 'Registration is disabled', metadata: settings }
      }
      return { ok: true, metadata: settings }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async register(ctx: JobContext, options: RegisterOptions): Promise<RegisterResult> {
    const emailProvider = this.registry.getEmail(ctx.emailProviderId)
    const siteConfig = options.siteConfig
    const baseUrl = String(siteConfig.baseUrl ?? DEFAULT_BASE_URL)
    const apiBaseUrl = normalizeApiBaseUrl(String(siteConfig.apiBaseUrl ?? DEFAULT_API_BASE_URL))
    const registerPath = String(siteConfig.registerPath ?? DEFAULT_REGISTER_PATH)
    const startUrl = String(siteConfig.startUrl ?? '').trim()
    const passwordLength = Number(siteConfig.passwordLength ?? 16)
    const interStepDelayMs = Number(siteConfig.interStepDelayMs ?? 800)
    const registerUrl = startUrl || this.buildPageUrl(baseUrl, registerPath)
    const browser = ctx.browser

    try {
      const publicSettings = await this.fetchPublicSettings(apiBaseUrl, ctx.proxy)
      if (publicSettings.registration_enabled === false) {
        return { success: false, error: 'registration_disabled' }
      }

      ctx.log('info', 'Clearing AI-ROUTER browser profile before registration...')
      await browser.clearStorage()
      ctx.log('info', 'Loading registration page...')
      await browser.navigate(registerUrl)
      ctx.log('info', 'Registration page DOM ready')
      if (!ctx.headless) browser.show()

      let formReady = await this.waitForRenderedForm(ctx, ctx.headless ? 15000 : 30000)
      if (!formReady && ctx.headless) {
        browser.show()
        await delay(3000, ctx.abortSignal)
        formReady = await this.waitForRenderedForm(ctx, 15000)
      }
      if (!formReady) {
        return { success: false, error: 'registration_form_not_found' }
      }

      const inbox = await this.createInbox(ctx, emailProvider)
      const password = generatePassword(passwordLength)
      const username = generateUsernameFromEmail(inbox.address)

      ctx.log('info', `Email: ${inbox.address}`)
      await this.fillField(ctx, 'email', FIELD_SELECTORS.email, FIELD_PLACEHOLDERS.email, inbox.address)
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillField(ctx, 'password', FIELD_SELECTORS.password, FIELD_PLACEHOLDERS.password, password)
      await delay(interStepDelayMs, ctx.abortSignal)

      ctx.log('info', 'Submitting registration form...')
      const registerAction = await this.clickActionButton(
        ctx,
        BUTTON_TEXT.register,
        publicSettings.turnstile_enabled === true,
        'register'
      )
      if (!registerAction.ok) {
        return { success: false, error: registerAction.error }
      }

      const phase = await this.waitForRegistrationPhase(ctx, registerUrl, 30000)
      if (phase.error && !(await this.isOnSuccessPath(ctx))) {
        return { success: false, error: phase.error }
      }
      if (phase.type === 'success' || (await this.isOnSuccessPath(ctx))) {
        const metadata = await this.buildSuccessMetadataSafely(baseUrl, apiBaseUrl, ctx)
        return { success: true, credentials: { username, email: inbox.address, password }, metadata }
      }

      await delay(interStepDelayMs, ctx.abortSignal)
      await this.requestVerificationCodeIfNeeded(ctx, publicSettings.turnstile_enabled === true)

      const code = await this.getVerificationCode(ctx, emailProvider, inbox)
      if (!code) return { success: false, error: 'verification_code_not_found' }
      ctx.log('info', `Verification code received: ${code}`)

      await this.fillField(
        ctx,
        'verification code',
        FIELD_SELECTORS.verificationCode,
        FIELD_PLACEHOLDERS.verificationCode,
        code
      )
      await delay(interStepDelayMs, ctx.abortSignal)

      ctx.log('info', 'Submitting verification form...')
      const verifyAction = await this.clickActionButton(
        ctx,
        BUTTON_TEXT.verify,
        publicSettings.turnstile_enabled === true,
        'verify'
      )
      if (!verifyAction.ok) {
        return { success: false, error: verifyAction.error }
      }

      const outcome = await this.waitForSuccess(ctx, registerUrl, 30000)
      if (!outcome.success && !(await this.isOnSuccessPath(ctx))) {
        return { success: false, error: outcome.error ?? 'registration_result_unknown' }
      }

      ctx.log('info', 'Registration successful')
      const metadata = await this.buildSuccessMetadataSafely(baseUrl, apiBaseUrl, ctx)
      return { success: true, credentials: { username, email: inbox.address, password }, metadata }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      ctx.log('error', error)
      return { success: false, error }
    }
  }

  private buildPageUrl(baseUrl: string, path: string): string {
    return new URL(path || DEFAULT_REGISTER_PATH, baseUrl).toString()
  }

  private async fetchPublicSettings(apiBaseUrl: string, proxy?: ProxyConfig): Promise<AiRouterPublicSettings> {
    const response = await this.fetch(`${apiBaseUrl}/settings/public`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }, proxy)
    const json = (await response.json().catch(() => ({}))) as WrappedResponse<AiRouterPublicSettings>
    if (!response.ok || json.code !== 0 || !json.data) {
      throw new Error(json.message || `AI-ROUTER public settings failed (${response.status})`)
    }
    return json.data
  }

  private async createInbox(ctx: JobContext, emailProvider: EmailProvider): Promise<Inbox> {
    const providerConfig = ctx.settings.emailProviders[ctx.emailProviderId] ?? {}
    const customEmail = String(ctx.customEmail ?? providerConfig.customEmail ?? '').trim()
    if (customEmail) {
      ctx.log('info', 'Using custom email inbox...')
      return {
        id: customEmail,
        address: customEmail,
        providerId: 'manual',
        createdAt: new Date().toISOString(),
        metadata: { manual: true }
      }
    }

    for (let attempt = 1; attempt <= MAX_INBOX_ATTEMPTS; attempt++) {
      ctx.log('info', `Creating temporary email inbox (${attempt}/${MAX_INBOX_ATTEMPTS})...`)
      const inbox = await emailProvider.createInbox(ctx)
      ctx.log('info', `Temporary email created: ${inbox.address}`)
      if (!emailProvider.validateInbox) return inbox

      ctx.log('info', `Validating inbox availability: ${inbox.address}`)
      const available = await emailProvider.validateInbox(ctx, inbox)
      if (available) return inbox

      ctx.log('warn', `Email is currently not available, retrying: ${inbox.address}`)
    }

    throw new Error('email_inbox_unavailable')
  }

  private async getVerificationCode(
    ctx: JobContext,
    emailProvider: EmailProvider,
    inbox: Inbox
  ): Promise<string | null> {
    if (inbox.metadata?.manual) {
      return this.waitForManualCode(ctx, inbox.address)
    }

    ctx.log('info', 'Waiting for verification code email...')
    const message = await emailProvider.waitForMessage(ctx, inbox, EMAIL_FILTER, OTP_TIMEOUT_MS)
    return this.extractVerificationCode(message) ?? emailProvider.extractCode?.(message, VERIFICATION_CODE_PATTERN) ?? null
  }

  private extractVerificationCode(message: EmailMessage): string | null {
    const combined = `${message.html ?? ''} ${message.text ?? ''}`
    const stripped = combined.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const labeled = stripped.match(VERIFICATION_CODE_PATTERN)
    if (labeled?.[1]) return labeled[1]
    const numericTokens = stripped.match(/\b\d{6}\b/g) ?? []
    return numericTokens.at(-1) ?? null
  }

  private async waitForManualCode(ctx: JobContext, email: string): Promise<string> {
    if (!ctx.requestManualOtp) throw new Error('manual_otp_requester_unavailable')

    ctx.log('info', `Waiting for manual OTP input for ${email}...`)
    const abortPromise = new Promise<string>((_, reject) => {
      if (ctx.abortSignal.aborted) {
        reject(new Error('Job cancelled'))
        return
      }
      ctx.abortSignal.addEventListener('abort', () => reject(new Error('Job cancelled')), { once: true })
    })

    const code = await Promise.race([
      ctx.requestManualOtp({ jobId: ctx.jobId, siteId: ctx.siteId, email }),
      abortPromise
    ])

    return String(code).trim()
  }

  private async fillField(
    ctx: JobContext,
    label: string,
    selectors: readonly string[],
    placeholders: readonly string[],
    value: string
  ): Promise<void> {
    ctx.log('info', `Filling ${label}...`)
    const result = await FormDriver.fillField(ctx.browser, selectors, placeholders, value)
    if (!result.ok) {
      throw new Error(`field_not_found:${label.replace(/\s+/g, '_')}${result.error ? ` (${result.error})` : ''}`)
    }
    ctx.log('info', `Filled ${label} (${result.matched})`)
  }

  private async waitForRenderedForm(ctx: JobContext, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')
      const rendered = await ctx.browser.executeScript<boolean>(`(() => {
        const email = document.querySelector('input[type="email"], input[name="email"], input[placeholder*="email" i]');
        const password = document.querySelector('input[type="password"], input[name="password"], input[placeholder*="password" i]');
        return Boolean(email && password);
      })()`)
      if (rendered) return true
      await delay(500, ctx.abortSignal)
    }
    return false
  }

  private async clickActionButton(
    ctx: JobContext,
    texts: readonly string[],
    turnstileEnabled: boolean,
    action: 'register' | 'verify'
  ): Promise<{ ok: boolean; error?: string }> {
    let result = await FormDriver.clickByTextWhenReady(ctx.browser, texts, 8000)
    if (!result.ok && result.disabled && turnstileEnabled) {
      ctx.log('info', `Waiting for Turnstile before ${action}...`)
      await CloakSession.waitForTurnstileToken(ctx.browser, {
        timeoutMs: 60000,
        manualTimeoutMs: 120000,
        showOnTimeout: true,
        onLog: (message) => ctx.log('info', message)
      })
      result = await FormDriver.clickByTextWhenReady(ctx.browser, texts, 10000)
    }
    if (!result.ok) {
      return {
        ok: false,
        error: result.disabled ? `${action}_button_disabled` : `${action}_button_not_found`
      }
    }
    ctx.log('info', `Clicked ${action}: "${result.matched}"`)
    return { ok: true }
  }

  private async requestVerificationCodeIfNeeded(ctx: JobContext, turnstileEnabled: boolean): Promise<void> {
    const state = await this.readAiRouterState(ctx)
    if (state.countdown > 0) {
      ctx.log('info', `Verification code countdown active (${state.countdown}s)`)
      return
    }

    let sendCode = await FormDriver.clickByTextWhenReady(ctx.browser, BUTTON_TEXT.sendCode, 5000)
    if (!sendCode.ok && sendCode.disabled && turnstileEnabled) {
      await CloakSession.waitForTurnstileToken(ctx.browser, {
        timeoutMs: 60000,
        manualTimeoutMs: 120000,
        showOnTimeout: true,
        onLog: (message) => ctx.log('info', message)
      })
      sendCode = await FormDriver.clickByTextWhenReady(ctx.browser, BUTTON_TEXT.sendCode, 8000)
    }

    if (sendCode.ok) {
      ctx.log('info', `Requested verification code: "${sendCode.matched}"`)
      await delay(1000, ctx.abortSignal)
      return
    }

    ctx.log('info', 'Verification code request button not found; assuming the site already sent the email')
  }

  private async waitForRegistrationPhase(
    ctx: JobContext,
    registerUrl: string,
    timeoutMs: number
  ): Promise<{ type: 'verify' | 'success'; error?: string }> {
    const deadline = Date.now() + timeoutMs
    let lastToast = ''

    while (Date.now() < deadline) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')
      const state = await this.readAiRouterState(ctx)

      try {
        const current = new URL(state.url)
        const start = new URL(registerUrl)
        if (VERIFY_PATHS.some((path) => current.pathname.startsWith(path)) || state.hasVerificationCodeInput) {
          ctx.log('info', 'Registration moved to email verification')
          return { type: 'verify' }
        }
        if (
          current.href !== start.href &&
          !current.pathname.startsWith(start.pathname) &&
          SUCCESS_PATHS.some((path) => current.pathname.startsWith(path))
        ) {
          ctx.log('info', `Detected redirect to ${current.pathname}`)
          return { type: 'success' }
        }
      } catch {
        // Ignore malformed URLs from embedded pages.
      }

      for (const toast of state.toasts) {
        if (toast === lastToast) continue
        lastToast = toast
        const lower = toast.toLowerCase()
        if (RESULT_KEYWORDS.failure.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('error', `Form error: ${toast}`)
          return { type: 'verify', error: `form_error: ${toast}` }
        }
        if (RESULT_KEYWORDS.success.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('info', `Success message: ${toast}`)
          return { type: 'success' }
        }
      }

      await delay(1000, ctx.abortSignal)
    }

    return { type: 'verify', error: 'registration_result_unknown' }
  }

  private async waitForSuccess(
    ctx: JobContext,
    registerUrl: string,
    timeoutMs: number
  ): Promise<{ success: boolean; error?: string }> {
    const deadline = Date.now() + timeoutMs
    let lastToast = ''

    while (Date.now() < deadline) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')

      const sessionState = await this.readSessionState(ctx)
      if (this.isSuccessfulSessionState(sessionState)) {
        if (sessionState.url) {
          try {
            ctx.log('info', `Detected authenticated session at ${new URL(sessionState.url).pathname}`)
          } catch {
            ctx.log('info', 'Detected authenticated session after verification')
          }
        }
        return { success: true }
      }

      const state = await this.readAiRouterState(ctx)
      for (const toast of state.toasts) {
        if (toast === lastToast) continue
        lastToast = toast
        const lower = toast.toLowerCase()

        if (RESULT_KEYWORDS.success.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('info', `Success message: ${toast}`)
          return { success: true }
        }

        if (RESULT_KEYWORDS.failure.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('error', `Form error: ${toast}`)
          return { success: false, error: `form_error: ${toast}` }
        }
      }

      try {
        const current = new URL(state.url)
        const start = new URL(registerUrl)
        if (
          current.href !== start.href &&
          !current.pathname.startsWith(start.pathname) &&
          SUCCESS_PATHS.some((path) => current.pathname.startsWith(path))
        ) {
          ctx.log('info', `Detected redirect to ${current.pathname}`)
          return { success: true }
        }
      } catch {
        // Ignore malformed URLs from embedded pages.
      }

      await delay(1000, ctx.abortSignal)
    }

    return (await this.isOnSuccessPath(ctx))
      ? { success: true }
      : { success: false, error: 'registration_result_unknown' }
  }

  private async isOnSuccessPath(ctx: JobContext): Promise<boolean> {
    const url = await ctx.browser.executeScript<string>('location.href').catch(() => '')
    if (!url) return false
    try {
      const pathname = new URL(url).pathname
      return SUCCESS_PATHS.some((path) => pathname.startsWith(path))
    } catch {
      return false
    }
  }

  private async readAiRouterState(ctx: JobContext): Promise<{
    url: string
    toasts: string[]
    hasVerificationCodeInput: boolean
    countdown: number
  }> {
    return ctx.browser.executeScript(`(() => {
      const toastNodes = Array.from(document.querySelectorAll(
        '[class*="toast"], [role="alert"], .semi-toast-content, .semi-notification-notice-content'
      ));
      const toasts = toastNodes
        .map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean);
      const codeInput = document.querySelector(
        'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="6"], input[name="code"], #code'
      );
      const countdownMatch = (document.body.innerText || '').match(/resend[^\\d]{0,20}(\\d{1,3})/i);
      return {
        url: location.href,
        toasts: Array.from(new Set(toasts)),
        hasVerificationCodeInput: Boolean(codeInput),
        countdown: countdownMatch ? Number(countdownMatch[1]) : 0
      };
    })()`)
  }

  private async buildSuccessMetadata(
    baseUrl: string,
    apiBaseUrl: string,
    ctx: JobContext
  ): Promise<Record<string, unknown>> {
    const uiOrigin = new URL(baseUrl).origin
    const apiOrigin = new URL(apiBaseUrl).origin
    const [uiCookies, apiCookies, authState] = await Promise.all([
      ctx.browser.getCookies(uiOrigin),
      ctx.browser.getCookies(apiOrigin),
      ctx.browser.executeScript<{
        authToken: string | null
        refreshToken: string | null
        authUser: unknown
      }>(`(() => {
        const parseJson = (value) => {
          if (!value) return null;
          try { return JSON.parse(value); } catch { return value; }
        };
        return {
          authToken: localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token'),
          refreshToken: localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token'),
          authUser: parseJson(localStorage.getItem('auth_user') || sessionStorage.getItem('auth_user'))
        };
      })()`).catch(() => ({ authToken: null, refreshToken: null, authUser: null }))
    ])

    ctx.log(
      'info',
      `Saved AI-ROUTER session snapshot (${uiCookies.length + apiCookies.length} cookies${authState.authToken ? ', auth token' : ''})`
    )
    return {
      aiRouterSession: {
        uiOrigin,
        apiOrigin,
        uiCookies,
        apiCookies,
        authToken: authState.authToken,
        refreshToken: authState.refreshToken,
        authUser: authState.authUser,
        capturedAt: new Date().toISOString()
      }
    }
  }

  private async buildSuccessMetadataSafely(
    baseUrl: string,
    apiBaseUrl: string,
    ctx: JobContext
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.buildSuccessMetadata(baseUrl, apiBaseUrl, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.log('warn', `AI-ROUTER registration succeeded but session snapshot failed: ${message}`)
      return undefined
    }
  }

  private async readSessionState(ctx: JobContext): Promise<{
    url: string
    authToken: string | null
    refreshToken: string | null
    authUserPresent: boolean
    hasVerificationCodeInput: boolean
  }> {
    return ctx.browser.executeScript(`(() => {
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const refreshToken = localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
      const authUser = localStorage.getItem('auth_user') || sessionStorage.getItem('auth_user');
      const codeInput = document.querySelector(
        'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="6"], input[name="code"], #code'
      );
      return {
        url: location.href,
        authToken: authToken && authToken.trim() ? authToken.trim() : null,
        refreshToken: refreshToken && refreshToken.trim() ? refreshToken.trim() : null,
        authUserPresent: Boolean(authUser && authUser.trim()),
        hasVerificationCodeInput: Boolean(codeInput)
      };
    })()`).catch(() => ({
      url: '',
      authToken: null,
      refreshToken: null,
      authUserPresent: false,
      hasVerificationCodeInput: false
    }))
  }

  private isSuccessfulSessionState(state: {
    url: string
    authToken: string | null
    refreshToken: string | null
    authUserPresent: boolean
    hasVerificationCodeInput: boolean
  }): boolean {
    if (state.url) {
      try {
        const pathname = new URL(state.url).pathname
        if (SUCCESS_PATHS.some((path) => pathname.startsWith(path))) return true
        if (!VERIFY_PATHS.some((path) => pathname.startsWith(path)) && state.authUserPresent) return true
      } catch {
        // Ignore malformed URLs from embedded pages.
      }
    }

    if (!state.hasVerificationCodeInput && (state.authToken || state.refreshToken || state.authUserPresent)) {
      return true
    }

    return false
  }

  private fetch(url: string, init: RequestInit, proxy?: ProxyConfig): Promise<Response> {
    const dispatcher = proxy ? this.proxyManager.createFetchDispatcher(proxy) : undefined
    return fetch(url, { ...init, dispatcher } as RequestInit)
  }
}
