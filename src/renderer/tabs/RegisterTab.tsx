import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  BrowserProfile,
  EmailMeta,
  JobProgressEvent,
  LogLevel,
  ProxyConfig,
  SiteMeta,
  TargetSiteConfig
} from '../../shared/contracts'
import {
  AlertTriangleIcon,
  Button,
  Card,
  CheckCircleIcon,
  Checkbox,
  Field,
  Input,
  PlayIcon,
  RocketIcon,
  Select,
  StopIcon,
  UsersIcon,
  ZapIcon
} from '../components/ui'

interface LogEntry {
  time: string
  level: LogLevel
  message: string
}

interface RunStats {
  started: number
  success: number
  failed: number
  planned: number | null
  startedAt: number | null
  finishedAt: number | null
}

const EMPTY_RUN_STATS: RunStats = {
  started: 0,
  success: 0,
  failed: 0,
  planned: null,
  startedAt: null,
  finishedAt: null
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function RegisterTab(): JSX.Element {
  const [sites, setSites] = useState<SiteMeta[]>([])
  const [emails, setEmails] = useState<EmailMeta[]>([])
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [targetSites, setTargetSites] = useState<TargetSiteConfig[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [siteId, setSiteId] = useState('tokenlb')
  const [targetSiteId, setTargetSiteId] = useState('')
  const [emailId, setEmailId] = useState('emailnator')
  const [browserMode, setBrowserMode] = useState<'auto' | 'fixed' | 'rotate'>('auto')
  const [profileId, setProfileId] = useState('')
  const [proxyMode, setProxyMode] = useState<'none' | 'fixed' | 'rotate' | 'profile'>('none')
  const [proxyId, setProxyId] = useState('')
  const [count, setCount] = useState(1)
  const [continuousRun, setContinuousRun] = useState(false)
  const [delay, setDelay] = useState(3000)
  const [maxConcurrent, setMaxConcurrent] = useState(1)
  const [headless, setHeadless] = useState(true)
  const [useCustomEmail, setUseCustomEmail] = useState(false)
  const [customEmail, setCustomEmail] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [runStats, setRunStats] = useState<RunStats>(EMPTY_RUN_STATS)
  const [now, setNow] = useState(Date.now())
  const logRef = useRef<HTMLDivElement>(null)

  const handleProgress = useCallback((event: JobProgressEvent): void => {
    const time = new Date().toLocaleTimeString()
    switch (event.type) {
      case 'log':
        setLogs((prev) => [...prev, { time, level: event.level, message: `[${event.jobId}] ${event.message}` }])
        break
      case 'job_started':
        setRunStats((prev) => ({
          ...prev,
          started: Math.max(prev.started, event.index),
          planned: event.continuous ? null : event.total
        }))
        setLogs((prev) => [
          ...prev,
          {
            time,
            level: 'info',
            message: event.continuous
              ? `--- Job ${event.index} started (${event.jobId}) ---`
              : `--- Job ${event.index}/${event.total} started (${event.jobId}) ---`
          }
        ])
        break
      case 'job_completed':
        setRunStats((prev) => ({
          ...prev,
          success: prev.success + (event.result.success ? 1 : 0),
          failed: prev.failed + (event.result.success ? 0 : 1)
        }))
        setLogs((prev) => [
          ...prev,
          {
            time,
            level: event.result.success ? 'info' : 'error',
            message: event.result.success
              ? `Job completed: ${event.result.credentials?.username}`
              : `Job failed: ${event.result.error}`
          }
        ])
        break
      case 'batch_completed':
        setRunning(false)
        setRunStats((prev) => ({
          ...prev,
          success: event.successCount,
          failed: event.failCount,
          finishedAt: Date.now()
        }))
        setLogs((prev) => [
          ...prev,
          {
            time,
            level: 'info',
            message: `Batch done — ${event.successCount} success, ${event.failCount} failed`
          }
        ])
        break
    }
  }, [])

  useEffect(() => {
    void loadData()
    const unsub = window.electronAPI.onJobProgress(handleProgress)
    return unsub
  }, [handleProgress])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  async function loadData(): Promise<void> {
    try {
      const [s, e, p, pr, st] = await Promise.all([
        window.electronAPI.listSites(),
        window.electronAPI.listEmailProviders(),
        window.electronAPI.listBrowserProfiles(),
        window.electronAPI.listProxies(),
        window.electronAPI.getSettings()
      ])
      setSites(s)
      setEmails(e)
      setProfiles(p)
      setProxies(pr)
      setTargetSites(st.targetSites.filter((target) => target.enabled))
      setSettings(st)
      const defaultTarget = st.targetSites.find((target) => target.id === st.defaults.targetSiteId && target.enabled)
      setTargetSiteId(defaultTarget?.id ?? st.targetSites.find((target) => target.enabled)?.id ?? '')
      setSiteId(defaultTarget?.providerId ?? st.defaults.siteId)
      setEmailId(st.defaults.emailProviderId)
      setBrowserMode(st.defaults.browserMode)
      setProxyMode(st.defaults.proxyMode)
      setContinuousRun(st.defaults.continuousRun ?? false)
      setDelay(st.defaults.interJobDelayMs)
      setMaxConcurrent(st.defaults.maxConcurrent)
      setHeadless(st.defaults.headless ?? true)
      const savedCustomEmail = String(st.emailProviders[st.defaults.emailProviderId]?.customEmail ?? '').trim()
      if (savedCustomEmail) {
        setUseCustomEmail(true)
        setCustomEmail(savedCustomEmail)
      }
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString(),
          level: 'error',
          message: `Failed to load configuration: ${String(err)}`
        }
      ])
    }
  }

  async function handleStart(): Promise<void> {
    if (!window.electronAPI?.startJob) {
      setLogs([
        {
          time: new Date().toLocaleTimeString(),
          level: 'error',
          message: 'Electron API unavailable. Launch the app with npm run dev (not the Vite URL alone).'
        }
      ])
      return
    }

    const time = new Date().toLocaleTimeString()
    const planned = continuousRun ? null : Math.max(1, Number(count) || 1)
    const startedAt = Date.now()
    setRunStats({
      ...EMPTY_RUN_STATS,
      planned,
      startedAt,
      finishedAt: null
    })
    setNow(startedAt)
    setLogs([
      {
        time,
        level: 'info',
        message: continuousRun ? 'Starting continuous registration...' : 'Starting registration batch...'
      }
    ])
    setRunning(true)

    try {
      const latestSettings = await window.electronAPI.getSettings()
      setSettings(latestSettings)

      const configuredCustomEmail = String(latestSettings.emailProviders[emailId]?.customEmail ?? '').trim()
      const normalizedCustomEmail = (useCustomEmail ? customEmail : configuredCustomEmail).trim()
      if (normalizedCustomEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedCustomEmail)) {
        throw new Error('Enter a valid custom email address')
      }

      const jobCount = Math.max(1, Number(count) || 1)
      const jobMaxConcurrent = Math.max(1, Number(maxConcurrent) || 1)
      const selectedTarget = latestSettings.targetSites.find((target) => target.id === targetSiteId)
      if (!selectedTarget) {
        throw new Error('Select a target site')
      }
      if (!selectedTarget.enabled) {
        throw new Error('Selected target site is disabled')
      }

      if (browserMode === 'fixed' && !profileId) {
        throw new Error('Select a browser profile for fixed browser mode')
      }
      if (proxyMode === 'fixed' && !proxyId) {
        throw new Error('Select a proxy for fixed proxy mode')
      }

      await window.electronAPI.startJob({
        siteId: selectedTarget.providerId,
        targetSiteId: selectedTarget.id,
        emailProviderId: emailId,
        count: jobCount,
        continuous: continuousRun,
        customEmail: normalizedCustomEmail || undefined,
        interJobDelayMs: Math.max(0, Number(delay) || 0),
        maxConcurrent: jobMaxConcurrent,
        headless,
        browser: {
          mode: browserMode,
          profileId: browserMode === 'fixed' ? profileId : undefined,
          profileIds: browserMode === 'rotate' ? profiles.map((p) => p.id) : undefined,
          clearCookiesOnRelease: true
        },
        proxy: {
          mode: proxyMode,
          proxyId: proxyMode === 'fixed' ? proxyId : undefined,
          proxyIds: proxyMode === 'rotate' ? proxies.map((p) => p.id) : undefined
        },
        siteConfig: latestSettings.siteConfigs[selectedTarget.providerId]
      })
    } catch (err) {
      setRunning(false)
      setLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), level: 'error', message: String(err) }
      ])
    }
  }

  async function handleCancel(): Promise<void> {
    await window.electronAPI.cancelJob()
    setRunning(false)
    setRunStats((prev) => ({ ...prev, finishedAt: Date.now() }))
  }

  const completed = runStats.success + runStats.failed
  const inFlight = Math.max(0, runStats.started - completed)
  const successRate = completed > 0 ? Math.round((runStats.success / completed) * 100) : 0
  const elapsedMs = runStats.startedAt
    ? (runStats.finishedAt ?? now) - runStats.startedAt
    : 0
  const progressLabel = runStats.planned == null ? `${completed}` : `${completed}/${runStats.planned}`

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Register Accounts</h1>
        <p className="page-subtitle">Configure your batch and launch automated registration.</p>
      </header>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-icon neutral">
            <UsersIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{progressLabel}</div>
            <div className="stat-label">Completed / Planned</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon neutral">
            <ZapIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{inFlight}</div>
            <div className="stat-label">Running Now</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon success">
            <CheckCircleIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{runStats.success}</div>
            <div className="stat-label">Success</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon danger">
            <AlertTriangleIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{runStats.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon neutral">
            <RocketIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{successRate}%</div>
            <div className="stat-label">Success Rate</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon neutral">
            <PlayIcon size={20} />
          </div>
          <div>
            <div className="stat-value">{formatDuration(elapsedMs)}</div>
            <div className="stat-label">Elapsed</div>
          </div>
        </div>
      </div>

      <Card title="Job Configuration" icon={<RocketIcon size={18} />}>
        <div className="form-grid">
          <Field label="Target Site">
            <Select
              value={targetSiteId}
              onChange={(e) => {
                const nextTarget = targetSites.find((target) => target.id === e.target.value)
                setTargetSiteId(e.target.value)
                if (nextTarget) setSiteId(nextTarget.providerId)
              }}
            >
              <option value="">Select...</option>
              {targetSites.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Email Provider">
            <Select value={emailId} onChange={(e) => setEmailId(e.target.value)}>
              {emails.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Custom Email"
            hint="When enabled, the app waits for you to enter the OTP manually."
          >
            <Checkbox
              label="Use my own email"
              checked={useCustomEmail}
              onChange={(e) => setUseCustomEmail(e.target.checked)}
            />
          </Field>

          {useCustomEmail && (
            <Field label="Email Address">
              <Input
                type="email"
                value={customEmail}
                placeholder="name@example.com"
                onChange={(e) => setCustomEmail(e.target.value)}
              />
            </Field>
          )}

          <Field label="Browser Mode">
            <Select value={browserMode} onChange={(e) => setBrowserMode(e.target.value as typeof browserMode)}>
              <option value="auto">Auto</option>
              <option value="fixed">Fixed</option>
              <option value="rotate">Rotate</option>
            </Select>
          </Field>

          {browserMode === 'fixed' && (
            <Field label="Browser Profile">
              <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">Select...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Proxy Mode">
            <Select value={proxyMode} onChange={(e) => setProxyMode(e.target.value as typeof proxyMode)}>
              <option value="none">None</option>
              <option value="fixed">Fixed</option>
              <option value="rotate">Rotate</option>
              <option value="profile">From Profile</option>
            </Select>
          </Field>

          {proxyMode === 'fixed' && (
            <Field label="Proxy">
              <Select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                <option value="">Select...</option>
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Count">
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              disabled={continuousRun}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </Field>

          <Field
            label="Continuous Run"
            hint="When enabled, registration keeps creating accounts until you click Cancel."
          >
            <Checkbox
              label="Create continuously"
              checked={continuousRun}
              onChange={(e) => setContinuousRun(e.target.checked)}
            />
          </Field>

          <Field label="Delay (ms)">
            <Input type="number" min={0} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
          </Field>

          <Field label="Max Concurrent">
            <Input
              type="number"
              min={1}
              max={10}
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(Number(e.target.value))}
            />
          </Field>

          <Field
            label="Headless browser"
            hint="When enabled, the browser window stays hidden during registration. Disable to watch Turnstile and sign-up live."
          >
            <Checkbox
              label="Run in headless mode"
              checked={headless}
              onChange={(e) => {
                const next = e.target.checked
                setHeadless(next)
                setSettings((prev) => {
                  if (!prev) return prev
                  const updated = { ...prev, defaults: { ...prev.defaults, headless: next } }
                  void window.electronAPI.saveSettings({ defaults: updated.defaults })
                  return updated
                })
              }}
            />
          </Field>
        </div>

        <div className="actions">
          <Button
            variant="primary"
            loading={running}
            icon={<PlayIcon size={16} />}
            onClick={() => void handleStart()}
          >
            {running ? 'Running...' : 'Register'}
          </Button>
          <Button
            variant="danger"
            icon={<StopIcon size={15} />}
            onClick={() => void handleCancel()}
            disabled={!running}
          >
            Cancel
          </Button>
        </div>
      </Card>

      <div className="log-panel">
        <div className="log-toolbar">
          <div className="log-dots">
            <span />
            <span />
            <span />
          </div>
          <span className="log-title">activity.log</span>
        </div>
        <div className="log-body" ref={logRef}>
          {logs.length === 0 ? (
            <div className="log-entry log-debug">
              <span className="log-msg">
                {running
                  ? 'Waiting for job progress...'
                  : 'Ready. Configure settings and click Register.'}
              </span>
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`log-entry log-${log.level}`}>
                <span className="log-time">[{log.time}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

    </>
  )
}
