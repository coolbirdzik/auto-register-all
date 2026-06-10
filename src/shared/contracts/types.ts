export type ProxyType = 'http' | 'https' | 'socks5' | 'direct'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ProxyConfig {
  id: string
  label: string
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
  bypass?: string
}

export interface ZingProxySettings {
  email?: string
  password?: string
  accessToken?: string
}

export type FreeProxySource = 'proxyscrape' | 'speedx-http' | 'monosans-http'

export interface FreeProxySettings {
  source?: FreeProxySource
  country?: string
}

export interface ZingProxyImportResult {
  imported: ProxyConfig[]
  skipped: number
  message?: string
}

export interface TargetSiteConfig {
  id: string
  label: string
  providerId: string
  startUrl: string
  enabled: boolean
  createdAt: string
}

export interface BrowserProfile {
  id: string
  label: string
  partition: string
  proxyId?: string
  userAgent?: string
  visible: boolean
  createdAt: string
}

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'secret' | 'number' | 'select' | 'boolean'
  required?: boolean
  default?: string | number | boolean
  options?: string[]
}

export interface Inbox {
  id: string
  address: string
  providerId: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface EmailMessage {
  id: string
  subject: string
  from: string
  date: string
  html?: string
  text?: string
}

export interface MessageFilter {
  subjectIncludes?: string
  fromIncludes?: string
  since?: string
}

export interface CreateInboxOptions {
  metadata?: Record<string, unknown>
}

export interface NavigateOptions {
  timeoutMs?: number
}

export interface SiteStatus {
  ok: boolean
  message?: string
  metadata?: Record<string, unknown>
}

export interface RegisterOptions {
  siteConfig: Record<string, unknown>
}

export interface RegisterResult {
  success: boolean
  credentials?: {
    username: string
    password: string
    email: string
    extras?: Record<string, string>
  }
  error?: string
  metadata?: Record<string, unknown>
}

export interface AccountRecord {
  id: string
  siteId: string
  siteName: string
  username: string
  password: string
  email: string
  registeredAt: string
  status: 'success' | 'failed'
  browserProfileId?: string
  proxyId?: string
  apiKey?: string
  apiKeyName?: string
  apiKeyId?: number
  apiKeyCreatedAt?: string
  apiKeyGroupId?: number
  apiKeyGroupName?: string
  apiKeyGroupPlatform?: string
  apiKeyGroupRateMultiplier?: number
  apiKeyGroupUpdatedAt?: string
  apiBalance?: number
  apiUsedQuota?: number
  apiBalanceLabel?: string
  apiBalanceFetchedAt?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface RegistrationLogRecord {
  id: string
  jobId: string
  siteId: string
  siteName: string
  status: 'failed'
  error: string
  email?: string
  username?: string
  browserProfileId?: string
  proxyId?: string
  createdAt: string
}

export interface NewApiTokenRecord {
  id: number
  user_id: number
  key: string
  status: number
  name: string
  created_time: number
  accessed_time: number
  expired_time: number
  remain_quota: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string
  used_quota: number
  group: string
  cross_group_retry: boolean
  DeletedAt: unknown
}

export interface CreatedApiKeyRecord {
  id: number
  key: string
  name: string
  createdAt?: string
  siteId?: string
  metadata?: Record<string, unknown>
}

export interface CreateNewApiKeyOptions {
  accountId: string
  name: string
  unlimitedQuota: boolean
  remainQuota: number
  expiredTime: number
  group: string
  modelLimitsEnabled: boolean
  modelLimits: string
  allowIps: string
  crossGroupRetry: boolean
}

export interface CreateNewApiKeyResult {
  account: AccountRecord
  token: CreatedApiKeyRecord
}

export interface GetApiKeyBalanceOptions {
  accountId: string
}

export interface GetApiKeyBalanceResult {
  account: AccountRecord
  balance: number
  used?: number
  label: string
  metadata?: Record<string, unknown>
}

export interface ApiKeyGroupOption {
  id: number
  name: string
  platform: string
  rateMultiplier: number
}

export interface ListApiKeyGroupsOptions {
  accountId: string
}

export interface UpdateApiKeyGroupOptions {
  accountId: string
  groupId: number
}

export interface UpdateApiKeyGroupResult {
  account: AccountRecord
  group: ApiKeyGroupOption
  metadata?: Record<string, unknown>
}

export interface AppSettings {
  emailProviders: Record<string, Record<string, unknown>>
  proxyProviders?: {
    zingproxy?: ZingProxySettings
    freeProxy?: FreeProxySettings
  }
  migrations?: {
    emailnatorDefaultApplied?: boolean
    weilaiChatTargetApplied?: boolean
    aiRouterTargetApplied?: boolean
  }
  siteConfigs: Record<string, Record<string, unknown>>
  targetSites: TargetSiteConfig[]
  browsers: BrowserProfile[]
  proxies: ProxyConfig[]
  defaults: {
    siteId: string
    targetSiteId?: string
    emailProviderId: string
    browserMode: JobBrowserOptions['mode']
    proxyMode: JobProxyOptions['mode']
    maxConcurrent: number
    interJobDelayMs: number
    useProxyForApi: boolean
    headless: boolean
    continuousRun: boolean
  }
}

export interface JobBrowserOptions {
  mode: 'auto' | 'fixed' | 'rotate'
  profileId?: string
  profileIds?: string[]
  clearCookiesOnRelease?: boolean
}

export interface JobProxyOptions {
  mode: 'none' | 'fixed' | 'rotate' | 'profile'
  proxyId?: string
  proxyIds?: string[]
}

export interface StartJobOptions {
  siteId: string
  targetSiteId?: string
  emailProviderId: string
  count: number
  customEmail?: string
  siteConfig?: Record<string, unknown>
  browser?: JobBrowserOptions
  proxy?: JobProxyOptions
  interJobDelayMs?: number
  maxConcurrent?: number
  headless?: boolean
  continuous?: boolean
}

export interface ManualOtpRequest {
  requestId: string
  jobId: string
  email: string
  siteId: string
}

export interface SiteMeta {
  id: string
  name: string
  baseUrl: string
  configSchema: ConfigField[]
}

export interface EmailMeta {
  id: string
  name: string
  configSchema: ConfigField[]
}

export interface AccountFilter {
  siteId?: string
  status?: 'success' | 'failed'
}

export interface ExportOptions {
  filter?: AccountFilter
  successOnly?: boolean
}

export interface ProxyTestResult {
  ok: boolean
  ip?: string
  latencyMs: number
  error?: string
}

export type JobProgressEvent =
  | { type: 'job_started'; jobId: string; index: number; total: number; continuous?: boolean }
  | { type: 'log'; jobId: string; level: LogLevel; message: string }
  | { type: 'job_completed'; jobId: string; result: RegisterResult; account?: AccountRecord }
  | { type: 'batch_completed'; successCount: number; failCount: number }
