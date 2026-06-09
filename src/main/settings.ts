import Store from 'electron-store'
import type { AppSettings, BrowserProfile } from '../shared/contracts'

const DEFAULT_SETTINGS: AppSettings = {
  emailProviders: {
    emailnator: {
      emailTypes: 'plusGmail, dotGmail, googleMail'
    }
  },
  proxyProviders: {
    zingproxy: {}
  },
  siteConfigs: {
    tokenlb: {
      baseUrl: 'https://tokenlb.net',
      usernamePrefix: 'user',
      affCode: 'Fp7I',
      interStepDelayMs: 1000
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
    }
  ],
  browsers: [],
  proxies: [],
  defaults: {
    siteId: 'tokenlb',
    targetSiteId: 'tokenlb-default',
    emailProviderId: 'gmailnator',
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
    this.removeUnsupportedProxies()
  }

  private migrateDefaultConcurrency(): void {
    const maxConcurrent = this.store.store.defaults?.maxConcurrent
    if (maxConcurrent === 3) {
      this.store.set('defaults.maxConcurrent', DEFAULT_SETTINGS.defaults.maxConcurrent)
    }
  }

  private removeUnsupportedProxies(): void {
    const proxies = this.store.store.proxies ?? []
    const supported = proxies.filter((proxy) => proxy.type !== 'socks5')
    if (supported.length !== proxies.length) {
      this.store.set('proxies', supported)
    }
  }

  private mergeEmailProviders(settings: AppSettings): AppSettings['emailProviders'] {
    return {
      ...DEFAULT_SETTINGS.emailProviders,
      ...settings.emailProviders,
      emailnator: {
        ...(DEFAULT_SETTINGS.emailProviders.emailnator ?? {}),
        ...(settings.emailProviders.emailnator ?? {})
      }
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
          }
        },
        proxyProviders: {
          zingproxy: {
            ...DEFAULT_SETTINGS.proxyProviders?.zingproxy,
            ...(settings.proxyProviders?.zingproxy ?? {})
          }
        }
      }
    }
    return {
      ...settings,
      emailProviders: this.mergeEmailProviders(settings),
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
