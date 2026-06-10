import { v4 as uuidv4 } from 'uuid'
import type {
  AccountRecord,
  AppSettings,
  JobProgressEvent,
  JobProxyOptions,
  RegisterResult,
  StartJobOptions
} from '../../shared/contracts'
import type { JobContext } from '../../shared/contracts/job-context'
import type { ManualOtpRequester } from '../../shared/contracts/job-context'
import type { BrowserSession } from '../../shared/contracts/browser-session'
import type { BrowserPool } from '../browser/browser-pool'
import type { ProxyManager } from '../proxy/proxy-manager'
import type { AccountStore } from '../storage/account-store'
import type { RegistrationLogStore } from '../storage/registration-log-store'
import type { ProviderRegistry } from './registry'

export class JobRunner {
  private abortControllers = new Map<string, AbortController>()
  private activeSessions = new Map<string, BrowserSession>()
  private batchController?: AbortController
  private currentBatchId?: string
  private running = false
  private cancelAll = false

  constructor(
    private registry: ProviderRegistry,
    private browserPool: BrowserPool,
    private proxyManager: ProxyManager,
    private accountStore: AccountStore,
    private registrationLogStore: RegistrationLogStore,
    private getSettings: () => AppSettings,
    private onProgress: (event: JobProgressEvent) => void,
    private requestManualOtp?: ManualOtpRequester
  ) {}

  isRunning(): boolean {
    return this.running
  }

  async startBatch(options: StartJobOptions): Promise<{ batchId: string }> {
    if (this.running) {
      throw new Error('A batch is already running')
    }

    const batchId = uuidv4()
    const batchController = new AbortController()
    this.running = true
    this.cancelAll = false
    this.currentBatchId = batchId
    this.batchController = batchController

    void this.runBatch(batchId, options, batchController.signal)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        this.onProgress({ type: 'log', jobId: batchId, level: 'error', message })
        this.onProgress({ type: 'batch_completed', successCount: 0, failCount: 0 })
      })
      .finally(() => {
        if (this.currentBatchId === batchId) {
          this.running = false
          this.cancelAll = false
          this.currentBatchId = undefined
          this.batchController = undefined
        }
      })

    return { batchId }
  }

  cancelJob(jobId: string): void {
    const controller = this.abortControllers.get(jobId)
    controller?.abort()
  }

  cancelAllJobs(): void {
    this.cancelAll = true
    this.batchController?.abort()
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
    for (const session of this.activeSessions.values()) {
      this.browserPool.release(session, true, false, false)
    }
    this.activeSessions.clear()
    this.abortControllers.clear()
    this.running = false
    this.currentBatchId = undefined
    this.batchController = undefined
  }

  private async runBatch(batchId: string, options: StartJobOptions, batchSignal: AbortSignal): Promise<void> {
    const settings = this.getSettings()
    const continuous = options.continuous ?? settings.defaults.continuousRun ?? false
    const count = Math.max(1, Number(options.count) || 1)
    const interJobDelayMs = options.interJobDelayMs ?? settings.defaults.interJobDelayMs
    const maxConcurrent = Math.max(
      1,
      Math.min(
        Number(options.maxConcurrent ?? settings.defaults.maxConcurrent) || 1,
        this.browserPool.getMaxConcurrent(),
        continuous ? Number.MAX_SAFE_INTEGER : count
      )
    )

    this.onProgress({
      type: 'log',
      jobId: batchId,
      level: 'info',
      message: continuous
        ? `Starting continuous batch, max ${maxConcurrent} concurrent`
        : `Starting batch: ${count} job(s), max ${maxConcurrent} concurrent`
    })

    let successCount = 0
    let failCount = 0
    let nextIndex = 0
    const inFlight: Promise<void>[] = []

    const runOne = async (index: number): Promise<void> => {
      if (batchSignal.aborted) return

      const jobId = `${batchId}-${index}`
      const controller = new AbortController()
      this.abortControllers.set(jobId, controller)

      this.onProgress({
        type: 'job_started',
        jobId,
        index: index + 1,
        total: count,
        continuous
      })

      let browserSession
      try {
        const browserOpts = options.browser ?? { mode: settings.defaults.browserMode }
        const proxyOpts = options.proxy ?? { mode: settings.defaults.proxyMode }

        const profileId = this.browserPool.pickProfileForJob(
          browserOpts.mode,
          index,
          browserOpts.profileId,
          browserOpts.profileIds
        )

        const proxy = this.resolveProxy(proxyOpts, index, profileId, settings)
        if (proxy) {
          this.onProgress({
            type: 'log',
            jobId,
            level: 'info',
            message: `Using proxy: ${proxy.type}://${proxy.host}:${proxy.port}`
          })
          const proxyTest = await this.proxyManager.test(proxy)
          if (controller.signal.aborted || batchSignal.aborted) {
            throw new Error('Job cancelled')
          }
          if (!proxyTest.ok) {
            const error = `proxy_test_failed: ${proxyTest.error ?? 'timeout'}`
            const site = this.registry.getSite(options.siteId)
            const result: RegisterResult = { success: false, error }
            failCount++
            await this.saveFailureLog(result, jobId, options.siteId, site.name, profileId, proxy.id)
            this.onProgress({ type: 'log', jobId, level: 'warn', message: `Skipping job: ${error}` })
            this.onProgress({ type: 'job_completed', jobId, result })
            return
          }
          this.onProgress({
            type: 'log',
            jobId,
            level: 'info',
            message: `Proxy OK: ${proxyTest.ip ?? 'unknown ip'} (${proxyTest.latencyMs}ms)`
          })
        }
        const headless = options.headless ?? settings.defaults.headless ?? true
        browserSession = await this.browserPool.acquire(profileId, proxy, headless)
        this.activeSessions.set(jobId, browserSession)

        const siteConfig = {
          ...(settings.siteConfigs[options.siteId] ?? {}),
          ...(options.siteConfig ?? {})
        }
        const targetSite = options.targetSiteId
          ? settings.targetSites.find((target) => target.id === options.targetSiteId)
          : undefined
        if (targetSite) {
          siteConfig.targetSiteId = targetSite.id
          siteConfig.targetSiteLabel = targetSite.label
          siteConfig.startUrl = targetSite.startUrl
        }

        const ctx: JobContext = {
          jobId,
          siteId: options.siteId,
          emailProviderId: options.emailProviderId,
          browser: browserSession,
          proxy: settings.defaults.useProxyForApi ? proxy : undefined,
          customEmail: options.customEmail,
          settings,
          headless,
          requestManualOtp: this.requestManualOtp,
          log: (level, message) => {
            this.onProgress({ type: 'log', jobId, level, message })
          },
          abortSignal: controller.signal
        }

        const site = this.registry.getSite(options.siteId)
        const result = await site.register(ctx, { siteConfig })
        if (controller.signal.aborted || batchSignal.aborted) {
          this.onProgress({ type: 'log', jobId, level: 'warn', message: 'Job cancelled' })
          return
        }

        const account = result.success
          ? await this.saveResult(result, options.siteId, site.name, browserSession.profileId, proxy?.id)
          : undefined

        if (result.success) {
          successCount++
        } else {
          failCount++
          await this.saveFailureLog(result, jobId, options.siteId, site.name, browserSession.profileId, proxy?.id)
        }

        this.onProgress({ type: 'job_completed', jobId, result, account })
      } catch (err) {
        if (controller.signal.aborted || batchSignal.aborted) {
          this.onProgress({ type: 'log', jobId, level: 'warn', message: 'Job cancelled' })
          return
        }
        const error = err instanceof Error ? err.message : String(err)
        const result: RegisterResult = { success: false, error }
        failCount++

        const site = this.registry.getSite(options.siteId)
        await this.saveFailureLog(result, jobId, options.siteId, site.name, browserSession?.profileId, undefined)

        this.onProgress({ type: 'log', jobId, level: 'error', message: error })
        this.onProgress({ type: 'job_completed', jobId, result })
      } finally {
        if (browserSession && !this.activeSessions.has(jobId)) {
          // Cancel already destroyed and released this session.
          browserSession = undefined
        }
        if (browserSession) {
          const clearCookies = options.browser?.clearCookiesOnRelease ?? true
          const headless = options.headless ?? settings.defaults.headless ?? true
          this.browserPool.release(browserSession, false, clearCookies, headless)
        }
        this.activeSessions.delete(jobId)
        this.abortControllers.delete(jobId)
      }
    }

    const scheduleNext = (): void => {
      if ((!continuous && nextIndex >= count) || batchSignal.aborted) return
      const index = nextIndex++
      const promise = runOne(index).then(() => {
        if (interJobDelayMs > 0 && (continuous || nextIndex < count)) {
          return new Promise<void>((r) => setTimeout(r, interJobDelayMs))
        }
      })
      inFlight.push(promise)
      promise.finally(() => {
        const idx = inFlight.indexOf(promise)
        if (idx !== -1) inFlight.splice(idx, 1)
        if (!batchSignal.aborted && inFlight.length < maxConcurrent && (continuous || nextIndex < count)) {
          scheduleNext()
        }
      })
    }

    const initialJobs = continuous ? maxConcurrent : Math.min(maxConcurrent, count)
    for (let i = 0; i < initialJobs; i++) {
      scheduleNext()
    }

    while (inFlight.length > 0) {
      await Promise.race(inFlight).catch(() => undefined)
    }

    if (!batchSignal.aborted) {
      this.onProgress({ type: 'batch_completed', successCount, failCount })
    } else {
      this.onProgress({ type: 'log', jobId: batchId, level: 'warn', message: 'Batch cancelled' })
    }
  }

  private resolveProxy(
    proxyOpts: JobProxyOptions,
    jobIndex: number,
    profileId: string | undefined,
    settings: AppSettings
  ) {
    switch (proxyOpts.mode) {
      case 'none':
        return undefined
      case 'fixed':
        return proxyOpts.proxyId ? this.proxyManager.get(proxyOpts.proxyId) : undefined
      case 'rotate':
        if (proxyOpts.proxyIds && proxyOpts.proxyIds.length > 0) {
          return this.proxyManager.nextFromPool(proxyOpts.proxyIds, jobIndex)
        }
        return this.proxyManager.next('round-robin')
      case 'profile': {
        if (!profileId) return undefined
        const profile = this.browserPool.listProfiles().find((p) => p.id === profileId)
        if (!profile?.proxyId) return undefined
        return this.proxyManager.get(profile.proxyId)
      }
      default:
        return undefined
    }
  }

  private async saveResult(
    result: RegisterResult,
    siteId: string,
    siteName: string,
    browserProfileId?: string,
    proxyId?: string
  ): Promise<AccountRecord> {
    const record: AccountRecord = {
      id: uuidv4(),
      siteId,
      siteName,
      username: result.credentials?.username ?? '',
      password: result.credentials?.password ?? '',
      email: result.credentials?.email ?? '',
      registeredAt: new Date().toISOString(),
      status: result.success ? 'success' : 'failed',
      browserProfileId,
      proxyId,
      error: result.error,
      metadata: result.metadata
    }
    await this.accountStore.append(record)
    return record
  }

  private async saveFailureLog(
    result: RegisterResult,
    jobId: string,
    siteId: string,
    siteName: string,
    browserProfileId?: string,
    proxyId?: string
  ): Promise<void> {
    await this.registrationLogStore.append({
      id: uuidv4(),
      jobId,
      siteId,
      siteName,
      status: 'failed',
      error: result.error ?? 'registration_failed',
      email: result.credentials?.email,
      username: result.credentials?.username,
      browserProfileId,
      proxyId,
      createdAt: new Date().toISOString()
    })
  }
}
