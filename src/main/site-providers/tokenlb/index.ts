import type {
  ConfigField,
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
import { TokenLBApiClient } from './api-client'
import {
  BUTTON_TEXT,
  DEFAULT_BASE_URL,
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

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Job cancelled'))

    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Job cancelled'))
    })
  })
}

export class TokenLBProvider implements SiteProvider {
  readonly id = 'tokenlb'
  readonly name = 'TokenLB (New API)'
  readonly baseUrl = DEFAULT_BASE_URL

  private api: TokenLBApiClient

  constructor(
    private registry: ProviderRegistry,
    proxyManager: ProxyManager
  ) {
    this.api = new TokenLBApiClient(proxyManager)
  }

  getConfigSchema(): ConfigField[] {
    return [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: DEFAULT_BASE_URL },
      { key: 'usernamePrefix', label: 'Username prefix', type: 'text', default: 'user' },
      { key: 'affCode', label: 'Referral code', type: 'text', default: 'Fp7I', required: false },
      { key: 'interStepDelayMs', label: 'Delay between steps (ms)', type: 'number', default: 1000 }
    ]
  }

  async checkStatus(ctx: JobContext): Promise<SiteStatus> {
    try {
      const baseUrl = String(ctx.settings.siteConfigs.tokenlb?.baseUrl ?? DEFAULT_BASE_URL)
      const status = await this.api.getStatus(baseUrl, ctx.proxy)
      return { ok: true, metadata: status }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async register(ctx: JobContext, options: RegisterOptions): Promise<RegisterResult> {
    const emailProvider = this.registry.getEmail(ctx.emailProviderId)
    const siteConfig = options.siteConfig
    const baseUrl = String(siteConfig.baseUrl ?? DEFAULT_BASE_URL)
    const usernamePrefix = String(siteConfig.usernamePrefix ?? 'user')
    const affCode = String(siteConfig.affCode ?? 'Fp7I').trim()
    const startUrl = String(siteConfig.startUrl ?? '').trim()
    const interStepDelayMs = Number(siteConfig.interStepDelayMs ?? 1000)
    const browser = ctx.browser

    try {
      const signUpUrl = startUrl || this.buildSignUpUrl(baseUrl, affCode)
      ctx.log('info', 'Loading sign-up page...')
      await browser.navigate(signUpUrl)
      ctx.log('info', 'Sign-up page DOM ready')
      if (!ctx.headless) {
        browser.show()
      }

      const formReady = await FormDriver.waitForAnySelector(browser, FORM_READY_SELECTORS, 30000)
      if (!formReady) {
        return { success: false, error: 'signup_form_not_found' }
      }
      await delay(Math.min(interStepDelayMs, 1500), ctx.abortSignal)

      const inbox = await this.createInbox(ctx, emailProvider)
      const username = generateUsernameFromEmail(inbox.address, usernamePrefix)
      const password = generatePassword(16)

      ctx.log('info', `Email: ${inbox.address}`)
      ctx.log('info', `Username: ${username}`)

      const diag = await FormDriver.diagnoseInputs(browser)
      ctx.log(
        'info',
        `Form diagnostics: ${diag.inputCount} visible inputs, placeholders=${JSON.stringify(diag.placeholders)}`
      )
      ctx.log('info', 'Sign-up form ready')

      await this.fillField(ctx, 'username', FIELD_SELECTORS.username, FIELD_PLACEHOLDERS.username, username)
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillField(ctx, 'password', FIELD_SELECTORS.password, FIELD_PLACEHOLDERS.password, password)
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillField(
        ctx,
        'confirm password',
        FIELD_SELECTORS.password2,
        FIELD_PLACEHOLDERS.password2,
        password
      )
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)
      await this.fillField(ctx, 'email', FIELD_SELECTORS.email, FIELD_PLACEHOLDERS.email, inbox.address)
      await delay(interStepDelayMs, ctx.abortSignal)

      ctx.log('info', 'Clicking "Send code"...')
      let getCode = await FormDriver.clickByTextWhenReady(browser, BUTTON_TEXT.getCode, 30000)
      if (!getCode.ok && getCode.disabled) {
        ctx.log('info', 'Send code is still disabled; waiting for Turnstile fallback...')
        await CloakSession.waitForTurnstileToken(browser, {
          timeoutMs: 60000,
          manualTimeoutMs: 120000,
          showOnTimeout: true,
          onLog: (message) => ctx.log('info', message)
        })
        ctx.log('info', 'Turnstile token present')
        getCode = await FormDriver.clickByTextWhenReady(browser, BUTTON_TEXT.getCode, 30000)
      }
      if (!getCode.ok) {
        const reason = getCode.disabled ? 'get_code_button_disabled' : 'get_code_button_not_found'
        return { success: false, error: reason }
      }
      ctx.log('info', `Clicked code button: "${getCode.matched}"`)

      await delay(interStepDelayMs, ctx.abortSignal)
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
      await delay(FIELD_STEP_DELAY_MS, ctx.abortSignal)

      ctx.log('info', 'Checking terms of service checkbox...')
      const terms = await FormDriver.checkTermsCheckbox(browser, TERMS_CHECKBOX_TEXT)
      if (!terms.ok) {
        ctx.log('warn', 'Terms checkbox not found; submit may be disabled')
      } else {
        ctx.log('info', `Terms accepted: "${terms.matched}"`)
      }
      await delay(interStepDelayMs, ctx.abortSignal)

      ctx.log('info', 'Submitting registration form...')
      const submit = await FormDriver.clickByTextWhenReady(browser, BUTTON_TEXT.submit, 20000)
      if (!submit.ok) {
        const reason = submit.disabled ? 'submit_button_disabled' : 'submit_button_not_found'
        return { success: false, error: reason }
      }
      ctx.log('info', `Clicked submit: "${submit.matched}"`)

      const outcome = await this.detectOutcome(ctx, signUpUrl)
      if (!outcome.success) {
        return { success: false, error: outcome.error ?? 'registration_failed' }
      }

      ctx.log('info', 'Registration successful')
      return {
        success: true,
        credentials: { username, password, email: inbox.address }
      }
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

    ctx.log('info', 'Creating temporary email inbox...')
    return emailProvider.createInbox(ctx)
  }

  private buildSignUpUrl(baseUrl: string, affCode: string): string {
    const url = new URL('/sign-up', baseUrl)
    if (affCode) {
      url.searchParams.set('aff', affCode)
    }
    return url.toString()
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
    const msg = await emailProvider.waitForMessage(ctx, inbox, { fromIncludes: 'tokenlb' }, 120_000)
    return emailProvider.extractCode?.(msg, VERIFICATION_CODE_PATTERN) ?? null
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

  private async detectOutcome(
    ctx: JobContext,
    signUpUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    const deadline = Date.now() + 20000
    let lastToast = ''

    while (Date.now() < deadline) {
      if (ctx.abortSignal.aborted) throw new Error('Job cancelled')
      const state = await FormDriver.readPageState(ctx.browser)

      try {
        const path = new URL(state.url).pathname
        if (state.url !== signUpUrl && SUCCESS_PATHS.some((p) => path.startsWith(p))) {
          ctx.log('info', `Detected redirect to ${path}`)
          return { success: true }
        }
      } catch {
        // Ignore malformed URLs from embedded pages.
      }

      for (const toast of state.toasts) {
        if (toast === lastToast) continue
        lastToast = toast
        const lower = toast.toLowerCase()

        if (RESULT_KEYWORDS.failure.some((k) => lower.includes(k.toLowerCase()))) {
          ctx.log('error', `Form error: ${toast}`)
          return { success: false, error: `form_error: ${toast}` }
        }

        if (RESULT_KEYWORDS.success.some((k) => lower.includes(k.toLowerCase()))) {
          ctx.log('info', `Success message: ${toast}`)
          return { success: true }
        }
      }

      await delay(1000, ctx.abortSignal)
    }

    return { success: false, error: 'registration_result_unknown' }
  }
}
