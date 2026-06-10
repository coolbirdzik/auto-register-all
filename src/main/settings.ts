import Store from 'electron-store'
import type { AppSettings, BrowserProfile } from '../shared/contracts'

const DEFAULT_SETTINGS: AppSettings = {
  emailProviders: {
    emailnator: {
      domain: false,
      plusGmail: true,
      dotGmail: true,
      googleMail: false
    }
  },
  proxyProviders: {
    zingproxy: {},
    freeProxy: {
      source: 'proxyscrape',
      country: 'vn'
    }
  },
  migrations: {},
  siteConfigs: {
    tokenlb: {
      baseUrl: 'https://tokenlb.net',
      usernamePrefix: 'user',
      affCode: 'Fp7I',
      interStepDelayMs: 1000
    },
    'weilai-chat': {
      baseUrl: 'https://api.weilai.chat',
      registerPath: '/register',
      passwordLength: 16,
      interStepDelayMs: 800
    },
    'ai-router': {
      baseUrl: 'https://ai-router.dev',
      apiBaseUrl: 'https://api.ai-router.dev/api/v1',
      registerPath: '/register',
      loginPath: '/login',
      passwordLength: 16,
      interStepDelayMs: 800
    }
  },
  targetSites: [
    {
      id: 'tokenlb-default',
      label: 'TokenLB Default',
      providerId: 'tokenlb',
      startUrl: 'https://tokenlb.net/sign-up?aff=Fp7I',
      enabled: true,
      createdAt: new Date(0).toISOString()
    },
    {
      id: 'weilai-chat-default',
      label: 'WeiLai.Chat Default',
      providerId: 'weilai-chat',
      startUrl: 'https://api.weilai.chat/register',
      enabled: true,
      createdAt: new Date(0).toISOString()
    },
    {
      id: 'ai-router-default',
      label: 'AI-ROUTER Default',
      providerId: 'ai-router',
      startUrl: 'https://ai-router.dev/register',
      enabled: true,
      createdAt: new Date(0).toISOString()
    }
  ],
  browsers: [],
  proxies: [],
  defaults: {
    siteId: 'tokenlb',
    targetSiteId: 'tokenlb-default',
    emailProviderId: 'emailnator',
    browserMode: 'auto',
    proxyMode: 'none',
    maxConcurrent: 1,
    interJobDelayMs: 3000,
    useProxyForApi: true,
    headless: true,
    continuousRun: false
  }
}

export class SettingsStore {
  private store: Store<AppSettings>

  constructor() {
    this.store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_SETTINGS
    })
    this.migrateDefaultConcurrency()
    this.migrateDefaultEmailProvider()
    this.migrateWeiLaiChatTarget()
    this.migrateAiRouterTarget()
    this.removeUnsupportedProxies()
  }

  private migrateDefaultConcurrency(): void {
    const maxConcurrent = this.store.store.defaults?.maxConcurrent
    if (maxConcurrent === 3) {
      this.store.set('defaults.maxConcurrent', DEFAULT_SETTINGS.defaults.maxConcurrent)
    }
  }

  private migrateDefaultEmailProvider(): void {
    if (this.store.store.migrations?.emailnatorDefaultApplied) return

    const emailProviderId = this.store.store.defaults?.emailProviderId
    if (!emailProviderId || emailProviderId === 'gmailnator') {
      this.store.set('defaults.emailProviderId', DEFAULT_SETTINGS.defaults.emailProviderId)
    }
    this.store.set('migrations.emailnatorDefaultApplied', true)
  }

  private migrateWeiLaiChatTarget(): void {
    if (this.store.store.migrations?.weilaiChatTargetApplied) return

    const targetSites = this.store.store.targetSites ?? []
    if (!targetSites.some((target) => target.id === 'weilai-chat-default')) {
      this.store.set('targetSites', [...targetSites, DEFAULT_SETTINGS.targetSites[1]])
    }

    this.store.set('siteConfigs.weilai-chat', {
      ...DEFAULT_SETTINGS.siteConfigs['weilai-chat'],
      ...(this.store.store.siteConfigs?.['weilai-chat'] ?? {})
    })
    this.store.set('migrations.weilaiChatTargetApplied', true)
  }

  private migrateAiRouterTarget(): void {
    if (this.store.store.migrations?.aiRouterTargetApplied) return

    const targetSites = this.store.store.targetSites ?? []
    if (!targetSites.some((target) => target.id === 'ai-router-default')) {
      this.store.set('targetSites', [...targetSites, DEFAULT_SETTINGS.targetSites[2]])
    }

    this.store.set('siteConfigs.ai-router', {
      ...DEFAULT_SETTINGS.siteConfigs['ai-router'],
      ...(this.store.store.siteConfigs?.['ai-router'] ?? {})
    })
    this.store.set('migrations.aiRouterTargetApplied', true)
  }

  private removeUnsupportedProxies(): void {
    const proxies = this.store.store.proxies ?? []
    const supported = proxies.filter((proxy) => proxy.type !== 'socks5')
    if (supported.length !== proxies.length) {
      this.store.set('proxies', supported)
    }
  }

  private mergeEmailProviders(settings: AppSettings): AppSettings['emailProviders'] {
    const rawEmailnator = {
      ...(DEFAULT_SETTINGS.emailProviders.emailnator ?? {}),
      ...(settings.emailProviders.emailnator ?? {})
    }
    const legacyEmailTypes = String(settings.emailProviders.emailnator?.emailTypes ?? '').trim()
    const legacyParts = legacyEmailTypes
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const hasBooleanFlags = ['domain', 'plusGmail', 'dotGmail', 'googleMail'].some(
      (key) => typeof rawEmailnator[key] === 'boolean'
    )
    const normalizedEmailnator = hasBooleanFlags
      ? {
          domain: Boolean(rawEmailnator.domain),
          plusGmail: Boolean(rawEmailnator.plusGmail),
          dotGmail: Boolean(rawEmailnator.dotGmail),
          googleMail: Boolean(rawEmailnator.googleMail)
        }
      : {
          domain: legacyParts.includes('domain') || legacyParts.length === 0,
          plusGmail: legacyParts.includes('plusGmail') || legacyParts.length === 0,
          dotGmail: legacyParts.includes('dotGmail') || legacyParts.length === 0,
          googleMail: legacyParts.includes('googleMail') || legacyParts.length === 0
        }

    return {
      ...DEFAULT_SETTINGS.emailProviders,
      ...settings.emailProviders,
      emailnator: normalizedEmailnator
    }
  }

  get(): AppSettings {
    const settings = this.store.store
    const targetSites =
      settings.targetSites && settings.targetSites.length > 0
        ? settings.targetSites
        : DEFAULT_SETTINGS.targetSites
    if (!String(settings.siteConfigs.tokenlb?.affCode ?? '').trim()) {
      return {
        ...settings,
        emailProviders: this.mergeEmailProviders(settings),
        migrations: settings.migrations ?? DEFAULT_SETTINGS.migrations,
        targetSites,
        proxies: settings.proxies.filter((proxy) => proxy.type !== 'socks5'),
        defaults: {
          ...DEFAULT_SETTINGS.defaults,
          ...settings.defaults,
          targetSiteId: settings.defaults.targetSiteId ?? targetSites[0]?.id
        },
        siteConfigs: {
          ...settings.siteConfigs,
          tokenlb: {
            ...settings.siteConfigs.tokenlb,
            affCode: 'Fp7I'
          },
          'weilai-chat': {
            ...DEFAULT_SETTINGS.siteConfigs['weilai-chat'],
            ...(settings.siteConfigs['weilai-chat'] ?? {})
          },
          'ai-router': {
            ...DEFAULT_SETTINGS.siteConfigs['ai-router'],
            ...(settings.siteConfigs['ai-router'] ?? {})
          }
        },
        proxyProviders: {
          zingproxy: {
            ...DEFAULT_SETTINGS.proxyProviders?.zingproxy,
            ...(settings.proxyProviders?.zingproxy ?? {})
          },
          freeProxy: {
            ...DEFAULT_SETTINGS.proxyProviders?.freeProxy,
            ...(settings.proxyProviders?.freeProxy ?? {})
          }
        }
      }
    }
    return {
      ...settings,
      emailProviders: this.mergeEmailProviders(settings),
      migrations: settings.migrations ?? DEFAULT_SETTINGS.migrations,
      targetSites,
      proxies: settings.proxies.filter((proxy) => proxy.type !== 'socks5'),
      defaults: {
        ...DEFAULT_SETTINGS.defaults,
        ...settings.defaults,
        targetSiteId: settings.defaults.targetSiteId ?? targetSites[0]?.id
      },
      proxyProviders: {
        zingproxy: {
          ...DEFAULT_SETTINGS.proxyProviders?.zingproxy,
          ...(settings.proxyProviders?.zingproxy ?? {})
        },
        freeProxy: {
          ...DEFAULT_SETTINGS.proxyProviders?.freeProxy,
          ...(settings.proxyProviders?.freeProxy ?? {})
        }
      },
      siteConfigs: {
        ...settings.siteConfigs,
        'weilai-chat': {
          ...DEFAULT_SETTINGS.siteConfigs['weilai-chat'],
          ...(settings.siteConfigs['weilai-chat'] ?? {})
        },
        'ai-router': {
          ...DEFAULT_SETTINGS.siteConfigs['ai-router'],
          ...(settings.siteConfigs['ai-router'] ?? {})
        }
      }
    }
  }

  save(partial: Partial<AppSettings>): void {
    const current = this.get()
    this.store.set({
      ...current,
      ...partial,
      emailProviders: partial.emailProviders ?? current.emailProviders,
      proxyProviders: partial.proxyProviders ?? current.proxyProviders,
      migrations: partial.migrations ?? current.migrations,
      siteConfigs: partial.siteConfigs ?? current.siteConfigs,
      targetSites: partial.targetSites ?? current.targetSites,
      browsers: partial.browsers ?? current.browsers,
      proxies: partial.proxies ?? current.proxies,
      defaults: { ...current.defaults, ...partial.defaults }
    })
  }

  updateBrowsers(browsers: BrowserProfile[]): void {
    this.save({ browsers })
  }

  updateProxies(proxies: AppSettings['proxies']): void {
    this.save({ proxies })
  }
}
