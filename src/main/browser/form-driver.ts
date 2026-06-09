import type { BrowserSession } from '../../shared/contracts'

// Generic helpers for driving a React form inside a cloak browser session.
// All DOM work happens via `executeScript`; values are embedded into the
// injected script through JSON serialization.

export interface FillResult {
  ok: boolean
  matched: string
  error?: string
}

export interface ClickResult {
  ok: boolean
  matched: string
  disabled?: boolean
}

export interface PageState {
  url: string
  toasts: string[]
}

export interface InputDiagnostic {
  inputCount: number
  placeholders: string[]
  types: string[]
  names: string[]
}

const DOM_HELPERS = `
  function isVisibleInput(inp) {
    if (!inp || inp.type === 'hidden' || inp.disabled) return false;
    if (inp.name === 'cf-turnstile-response') return false;
    const style = window.getComputedStyle(inp);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = inp.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function normalizeText(value) {
    return (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  }

  function classText(node) {
    if (!node) return '';
    if (typeof node.className === 'string') return node.className;
    return String(node.getAttribute && node.getAttribute('class') || '');
  }

  function hasDisabledClass(node) {
    const classes = classText(node).split(/\\s+/).filter(Boolean);
    return classes.some((item) =>
      item === 'disabled' ||
      item === 'is-disabled' ||
      item === 'semi-button-disabled' ||
      item === 'btn-disabled'
    );
  }

  function dispatchInputEvents(el, value, previous) {
    if (el._valueTracker) {
      el._valueTracker.setValue(previous);
    }

    try {
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertText'
      }));
    } catch (e) {}

    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText'
      }));
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
  }

  function setReactInput(el, value) {
    const previous = el.value || '';
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
    el.focus();
    if (typeof el.select === 'function') el.select();

    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;

    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    dispatchInputEvents(el, value, previous);

    if (el.value !== value && document.queryCommandSupported && document.queryCommandSupported('insertText')) {
      el.focus();
      if (typeof el.select === 'function') el.select();
      document.execCommand('insertText', false, value);
      dispatchInputEvents(el, value, previous);
    }

    el.blur();
  }

  function findByLabel(inputs, placeholders) {
    const wanted = placeholders.map(normalizeText).filter(Boolean);
    const labels = Array.from(document.querySelectorAll('label'));

    for (const label of labels) {
      const text = normalizeText(label.textContent);
      if (!wanted.some((item) => text.includes(item))) continue;

      let target = null;
      const htmlFor = label.getAttribute('for');
      if (htmlFor) target = document.getElementById(htmlFor);
      if (!target) target = label.querySelector('input, textarea');
      if (!target) {
        const field = label.closest('[data-slot="form-item"], .semi-form-field, .form-item, div');
        if (field) target = field.querySelector('input, textarea');
      }

      if (target && inputs.includes(target)) {
        return { el: target, matched: 'label:' + text };
      }
    }

    return { el: null, matched: '' };
  }

  function findField(selectors, placeholders) {
    const phs = placeholders.map(normalizeText).filter(Boolean);

    for (const sel of selectors) {
      const found = document.querySelector(sel);
      if (found && isVisibleInput(found)) {
        return { el: found, matched: 'selector:' + sel };
      }
    }

    const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(isVisibleInput);

    const byLabel = findByLabel(inputs, placeholders);
    if (byLabel.el) return byLabel;

    for (const inp of inputs) {
      const ph = normalizeText(inp.getAttribute('placeholder') || '');
      if (!ph) continue;
      for (const p of phs) {
        if (ph === p) return { el: inp, matched: 'placeholder-exact:' + ph };
      }
    }

    for (const inp of inputs) {
      const haystack = [
        inp.getAttribute('placeholder'),
        inp.getAttribute('name'),
        inp.getAttribute('id'),
        inp.getAttribute('autocomplete'),
        inp.getAttribute('aria-label')
      ].map(normalizeText).filter(Boolean);

      for (const p of phs) {
        const match = haystack.find((item) => item.includes(p));
        if (match) return { el: inp, matched: 'attribute:' + match };
      }
    }

    return { el: null, matched: '' };
  }
`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class FormDriver {
  static async diagnoseInputs(browser: BrowserSession): Promise<InputDiagnostic> {
    const script = `(() => {
      ${DOM_HELPERS}
      const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(isVisibleInput);
      return {
        inputCount: inputs.length,
        placeholders: inputs.map((i) => i.getAttribute('placeholder') || ''),
        types: inputs.map((i) => i.type || ''),
        names: inputs.map((i) => i.name || '')
      };
    })()`
    return browser.executeScript<InputDiagnostic>(script)
  }

  static async waitForAnySelector(
    browser: BrowserSession,
    selectors: readonly string[],
    timeoutMs = 30000,
    pollIntervalMs = 300
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = await browser.executeScript<boolean>(
        `(() => {
          ${DOM_HELPERS}
          const sels = ${JSON.stringify(selectors)};
          return sels.some((s) => {
            const el = document.querySelector(s);
            return el && isVisibleInput(el);
          });
        })()`
      )
      if (found) return true
      await sleep(pollIntervalMs)
    }

    return false
  }

  static async fillField(
    browser: BrowserSession,
    selectors: readonly string[],
    placeholders: readonly string[],
    value: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<FillResult> {
    const timeoutMs = options?.timeoutMs ?? 15000
    const pollIntervalMs = options?.pollIntervalMs ?? 300
    const deadline = Date.now() + timeoutMs
    let last: FillResult = { ok: false, matched: '', error: 'field_not_found' }

    while (Date.now() < deadline) {
      const script = `new Promise((resolve) => {
        ${DOM_HELPERS}
        const selectors = ${JSON.stringify(selectors)};
        const placeholders = ${JSON.stringify(placeholders)};
        const value = ${JSON.stringify(value)};
        const found = findField(selectors, placeholders);
        if (!found.el) {
          resolve({ ok: false, matched: '', error: 'element_not_in_dom' });
          return;
        }

        try {
          setReactInput(found.el, value);
          window.setTimeout(() => {
            const actual = found.el.value;
            if (actual !== value) {
              resolve({ ok: false, matched: found.matched, error: 'value_not_retained' });
              return;
            }
            resolve({ ok: true, matched: found.matched });
          }, 100);
        } catch (e) {
          resolve({ ok: false, matched: found.matched, error: String(e && e.message ? e.message : e) });
        }
      })`

      try {
        last = await browser.executeScript<FillResult>(script)
        if (last.ok) return last
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        last = { ok: false, matched: '', error: `executeScript: ${message}` }
      }

      await sleep(pollIntervalMs)
    }

    return last
  }

  static async checkTermsCheckbox(
    browser: BrowserSession,
    textFragments: readonly string[]
  ): Promise<ClickResult> {
    const script = `(() => {
      const texts = ${JSON.stringify(textFragments)}.map((t) => t.toLowerCase());
      const matchesText = (node) => {
        const t = (node.textContent || '').toLowerCase();
        return texts.some((x) => t.includes(x));
      };

      const labels = Array.from(document.querySelectorAll('label.semi-checkbox, label'));
      for (const label of labels) {
        if (!matchesText(label)) continue;
        const cb = label.querySelector('input[type="checkbox"]');
        if (cb) {
          if (!cb.checked) {
            label.click();
            if (!cb.checked) cb.click();
          }
          return { ok: true, matched: (label.textContent || '').trim().slice(0, 80) };
        }
      }

      const boxes = Array.from(document.querySelectorAll('.semi-checkbox'));
      for (const box of boxes) {
        if (!matchesText(box)) continue;
        const cb = box.querySelector('input[type="checkbox"]');
        const checked = cb ? cb.checked : box.classList.contains('semi-checkbox-checked');
        if (!checked) box.click();
        return { ok: true, matched: (box.textContent || '').trim().slice(0, 80) };
      }

      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      for (const cb of checkboxes) {
        const container = cb.closest('label, .semi-checkbox, .semi-form-field') || cb.parentElement;
        if (!container || !matchesText(container)) continue;
        if (!cb.checked) {
          container.click();
          if (!cb.checked) cb.click();
        }
        return { ok: true, matched: (container.textContent || '').trim().slice(0, 80) };
      }

      return { ok: false, matched: '' };
    })()`
    return browser.executeScript<ClickResult>(script)
  }

  static async clickByText(
    browser: BrowserSession,
    texts: readonly string[]
  ): Promise<ClickResult> {
    const script = `(() => {
      ${DOM_HELPERS}
      const texts = ${JSON.stringify(texts)};
      const nodes = Array.from(
        document.querySelectorAll('button, a, [role="button"], .semi-button')
      );

      for (const node of nodes) {
        const t = (node.textContent || '').trim();
        if (!t) continue;
        if (texts.some((x) => t.includes(x))) {
          const disabled = node.disabled === true ||
            node.hasAttribute('disabled') ||
            node.hasAttribute('data-disabled') ||
            node.getAttribute('aria-disabled') === 'true' ||
            hasDisabledClass(node);
          if (disabled) return { ok: false, matched: t, disabled: true };
          node.click();
          return { ok: true, matched: t };
        }
      }

      return { ok: false, matched: '' };
    })()`
    return browser.executeScript<ClickResult>(script)
  }

  static async clickByTextWhenReady(
    browser: BrowserSession,
    texts: readonly string[],
    timeoutMs = 30000,
    pollIntervalMs = 500
  ): Promise<ClickResult> {
    const deadline = Date.now() + timeoutMs
    let last: ClickResult = { ok: false, matched: '' }
    while (Date.now() < deadline) {
      last = await this.clickByText(browser, texts)
      if (last.ok) return last
      await sleep(pollIntervalMs)
    }
    return last
  }

  static async readPageState(browser: BrowserSession): Promise<PageState> {
    const script = `(() => {
      const nodes = Array.from(document.querySelectorAll(
        '.semi-toast-content, .semi-toast, .semi-notification-notice-content, [class*="toast"]'
      ));
      const toasts = nodes
        .map((n) => (n.textContent || '').trim())
        .filter((t) => t.length > 0);
      return { url: location.href, toasts: Array.from(new Set(toasts)) };
    })()`
    return browser.executeScript<PageState>(script)
  }
}
