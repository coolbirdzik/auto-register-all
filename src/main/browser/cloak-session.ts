import type { BrowserSession } from '../../shared/contracts'

// Reads the current Cloudflare Turnstile token from the page, if present.
// New API / React sign-up pages render the widget asynchronously and store the
// solved token in a hidden input/textarea named "cf-turnstile-response".
const READ_TOKEN_SCRIPT = `(() => {
  try {
    const selectors = [
      'input[name="cf-turnstile-response"]',
      'textarea[name="cf-turnstile-response"]',
      '[name="cf-turnstile-response"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.value) return el.value;
    }
    return '';
  } catch (e) {
    return '';
  }
})()`

interface WaitForTurnstileOptions {
  timeoutMs?: number
  showOnTimeout?: boolean
  manualTimeoutMs?: number
  pollIntervalMs?: number
  onLog?: (message: string) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class CloakSession {
  static async waitForTurnstileToken(
    browser: BrowserSession,
    options?: WaitForTurnstileOptions
  ): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 60000
    const pollIntervalMs = options?.pollIntervalMs ?? 1000
    const manualTimeoutMs = options?.manualTimeoutMs ?? 120000
    const log = options?.onLog ?? ((): void => {})

    const readToken = async (): Promise<string> => {
      try {
        const token = await browser.executeScript<string>(READ_TOKEN_SCRIPT)
        return token ?? ''
      } catch {
        return ''
      }
    }

    log('Waiting for Turnstile token...')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const token = await readToken()
      if (token) {
        log('Got Turnstile token')
        return token
      }
      await sleep(pollIntervalMs)
    }

    // Automatic solving did not complete in time. Surface the window so the
    // user can solve the challenge manually, then keep polling for a while.
    if (options?.showOnTimeout) {
      log('Turnstile token not detected automatically. Showing window for manual solving...')
      browser.show()
      const manualDeadline = Date.now() + manualTimeoutMs
      while (Date.now() < manualDeadline) {
        const token = await readToken()
        if (token) {
          log('Got Turnstile token')
          return token
        }
        await sleep(pollIntervalMs)
      }
    }

    log('Turnstile token timeout: no token obtained')
    throw new Error('turnstile_timeout')
  }

  static async waitForCondition(
    browser: BrowserSession,
    predicateScript: string,
    timeoutMs: number
  ): Promise<unknown> {
    const script = `
      new Promise((resolve, reject) => {
        const deadline = Date.now() + ${timeoutMs};
        const tick = () => {
          try {
            const result = (${predicateScript})();
            if (result) return resolve(result);
          } catch (e) {}
          if (Date.now() > deadline) return reject(new Error('condition_timeout'));
          setTimeout(tick, 500);
        };
        tick();
      })
    `
    return browser.executeScript(script)
  }
}
