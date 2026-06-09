import type {
  ConfigField,
  EmailProvider,
  Inbox,
  RegisterOptions,
  RegisterResult,
  EmailMessage,
  SiteProvider,
  SiteStatus
} from '../../../shared/contracts'
import type { JobContext } from '../../../shared/contracts/job-context'
import { FormDriver } from '../../browser/form-driver'
import type { ProviderRegistry } from '../../core/registry'
import type { ProxyManager } from '../../proxy/proxy-manager'
import {
  BUTTON_TEXT,
  DEFAULT_BASE_URL,
  DEFAULT_REGISTER_PATH,
  EMAIL_FILTER,
  FIELD_PLACEHOLDERS,
  FIELD_SELECTORS,
  FORM_READY_SELECTORS,
  RESULT_KEYWORDS,
  SUCCESS_PATHS,
  TERMS_CHECKBOX_TEXT,
  VERIFICATION_CODE_PATTERN
} from './constants'
import { generatePassword, generateUsernameFromEmail } from './credentials'

const FIELD_STEP_DELAY_MS = 400
const MAX_INBOX_ATTEMPTS = 5
const OTP_TIMEOUT_MS = 120_000

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

export class WeiLaiChatProvider implements SiteProvider {
  readonly id = 'weilai-chat'
  readonly name = 'WeiLai.Chat'
  readonly baseUrl = DEFAULT_BASE_URL

  constructor(
    private registry: ProviderRegistry,
    private proxyManager: ProxyManager
  ) {}

  getConfigSchema(): ConfigField[] {
    return [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: DEFAULT_BASE_URL },
      { key: 'registerPath', label: 'Register Path', type: 'text', default: DEFAULT_REGISTER_PATH },
      { key: 'passwordLength', label: 'Password Length', type: 'number', default: 16 },
      { key: 'interStepDelayMs', label: 'Delay between steps (ms)', type: 'number', default: 800 }
    ]
  }

  async checkStatus(ctx: JobContext): Promise<SiteStatus> {
    try {
      const baseUrl = String(ctx.settings.siteConfigs[this.id]?.baseUrl ?? DEFAULT_BASE_URL)
      const response = await this.proxyManager.fetch(`${baseUrl.replace(/\/$/, '')}/register`, {
        method: 'GET',
        proxy: ctx.proxy
      })
      return { ok: response.ok, message: response.ok ? undefined : `HTTP ${response.status}` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async register(ctx: JobContext, options: RegisterOptions): Promise<RegisterResult> {
    const emailProvider = this.registry.getEmail(ctx.emailProviderId)
    const siteConfig = options.siteConfig
    const baseUrl = String(siteConfig.baseUrl ?? DEFAULT_BASE_URL)
    const registerPath = String(siteConfig.registerPath ?? DEFAULT_REGISTER_PATH)
    const startUrl = String(siteConfig.startUrl ?? '').trim()
    const passwordLength = Number(siteConfig.passwordLength ?? 16)
    const interStepDelayMs = Number(siteConfig.interStepDelayMs ?? 800)
    const registerUrl = startUrl || this.buildRegisterUrl(baseUrl, registerPath)
    const browser = ctx.browser

    try {
      ctx.log('info', 'Loading registration page...')
      await browser.navigate(registerUrl)
      ctx.log('info', 'Registration page DOM ready')
      if (!ctx.headless) {
        browser.show()
      }

      const formReady = await this.waitForRenderedForm(ctx, 30000)
      if (!formReady) {
        return { success: false, error: 'registration_form_not_found' }
      }
      await delay(Math.min(interStepDelayMs, 1500), ctx.abortSignal)

      ctx.log('info', 'Accepting agreement policy...')
      const terms = await FormDriver.checkTermsCheckbox(browser, TERMS_CHECKBOX_TEXT)
      if (terms.ok) {
        ctx.log('info', `Agreement accepted: "${terms.matched}"`)
        await delay(interStepDelayMs, ctx.abortSignal)
      } else {
        ctx.log('warn', 'Agreement checkbox not found; form may remain disabled')
      }

      const inbox = await this.createInbox(ctx, emailProvider)
      const password = generatePassword(passwordLength)
      const username = generateUsernameFromEmail(inbox.address)

      ctx.log('info', `Email: ${inbox.address}`)
      ctx.log('info', 'Registration form ready')

      await this.fillField(ctx, 'email', FIELD_SELECTORS.email, FIELD_PLACEHOLDERS.email, inbox.address)
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillField(ctx, 'password', FIELD_SELECTORS.password, FIELD_PLACEHOLDERS.password, password)
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillOptionalField(
        ctx,
        'confirm password',
        FIELD_SELECTORS.confirmPassword,
        FIELD_PLACEHOLDERS.confirmPassword,
        password
      )
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)

      ctx.log('info', 'Submitting registration form...')
      const submit = await FormDriver.clickByTextWhenReady(browser, BUTTON_TEXT.register, 30000)
      if (!submit.ok) {
        const reason = submit.disabled ? 'register_button_disabled' : 'register_button_not_found'
        return { success: false, error: reason }
      }
      ctx.log('info', `Clicked register: "${submit.matched}"`)

      const otpReady = await FormDriver.waitForAnySelector(browser, FIELD_SELECTORS.verificationCode, 30000)
      if (!otpReady) {
        const earlyOutcome = await this.detectOutcome(ctx, registerUrl, 5000)
        if (earlyOutcome.success) {
          return { success: true, credentials: { username, email: inbox.address, password } }
        }
        return { success: false, error: earlyOutcome.error ?? 'otp_form_not_found' }
      }

      const code = await this.getVerificationCode(ctx, emailProvider, inbox)
      if (!code) {
        return { success: false, error: 'verification_code_not_found' }
      }
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
      const verify = await FormDriver.clickByTextWhenReady(browser, BUTTON_TEXT.verify, 30000)
      if (!verify.ok) {
        const reason = verify.disabled ? 'verify_button_disabled' : 'verify_button_not_found'
        return { success: false, error: reason }
      }
      ctx.log('info', `Clicked verify: "${verify.matched}"`)

      const outcome = await this.detectOutcome(ctx, registerUrl, 30000)
      if (!outcome.success) {
        return { success: false, error: outcome.error ?? 'registration_result_unknown' }
      }

      ctx.log('info', 'Registration successful')
      return { success: true, credentials: { username, email: inbox.address, password } }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      ctx.log('error', error)
      return { success: false, error }
    }
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

  private buildRegisterUrl(baseUrl: string, registerPath: string): string {
    return new URL(registerPath || DEFAULT_REGISTER_PATH, baseUrl).toString()
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
    const msg = await emailProvider.waitForMessage(ctx, inbox, EMAIL_FILTER, OTP_TIMEOUT_MS)
    return this.extractVerificationCode(msg) ?? emailProvider.extractCode?.(msg, VERIFICATION_CODE_PATTERN) ?? null
  }

  private extractVerificationCode(message: EmailMessage): string | null {
    const html = `${message.html ?? ''} ${message.text ?? ''}`
    const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const labeled = stripped.match(VERIFICATION_CODE_PATTERN)
    if (labeled?.[1]) return labeled[1]

    const prominent = html.match(/font-size:\s*32px[^>]*>\s*(\d{6})\s*</i)
    if (prominent?.[1]) return prominent[1]

    const numericTokens = stripped.match(/\b\d{6}\b/g) ?? []
    return numericTokens.at(-1) ?? null
  }

  private async waitForManualCode(ctx: JobContext, email: string): Promise<string> {
    if (!ctx.requestManualOtp) {
      throw new Error('manual_otp_requester_unavailable')
    }

    ctx.log('info', `Waiting for manual OTP input for ${email}...`)
    const abortPromise = new Promise<string>((_, reject) => {
      if (ctx.abortSignal.aborted) {
        reject(new Error('Job cancelled'))
        return
      }

      ctx.abortSignal.addEventListener('abort', () => reject(new Error('Job cancelled')), {
        once: true
      })
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
      const detail = result.error ? ` (${result.error})` : ''
      const diag = await FormDriver.diagnoseInputs(ctx.browser).catch(() => null)
      if (diag) {
        ctx.log(
          'error',
          `Failed to fill ${label}${detail}. Visible inputs: ${JSON.stringify(diag.placeholders)}`
        )
      } else {
        ctx.log('error', `Failed to fill ${label}${detail}`)
      }
      throw new Error(`field_not_found:${label.replace(/\s+/g, '_')}${detail}`)
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

  private async fillOptionalField(
    ctx: JobContext,
    label: string,
    selectors: readonly string[],
    placeholders: readonly string[],
    value: string
  ): Promise<void> {
    ctx.log('info', `Checking optional ${label}...`)
    const result = await FormDriver.fillField(ctx.browser, selectors, placeholders, value, {
      timeoutMs: 2500,
      pollIntervalMs: 250
    })
    if (result.ok) {
      ctx.log('info', `Filled ${label} (${result.matched})`)
    } else {
      ctx.log('info', `Optional ${label} field not present`)
    }
  }

  private async detectOutcome(
    ctx: JobContext,
    registerUrl: string,
    timeoutMs: number
  ): Promise<{ success: boolean; error?: string }> {
    const deadline = Date.now() + timeoutMs
    let lastToast = ''

    while (Date.now() < deadline) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')
      const state = await FormDriver.readPageState(ctx.browser)

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

      for (const toast of state.toasts) {
        if (toast === lastToast) continue
        lastToast = toast
        const lower = toast.toLowerCase()

        if (RESULT_KEYWORDS.failure.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('error', `Form error: ${toast}`)
          return { success: false, error: `form_error: ${toast}` }
        }

        if (RESULT_KEYWORDS.success.some((keyword) => lower.includes(keyword.toLowerCase()))) {
          ctx.log('info', `Success message: ${toast}`)
          return { success: true }
        }
      }

      await delay(1000, ctx.abortSignal)
    }

    return { success: false, error: 'registration_result_unknown' }
  }
}
