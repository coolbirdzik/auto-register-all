import { useEffect, useState } from 'react'
import type { AppUpdateState, ManualOtpRequest } from '../shared/contracts'
import RegisterTab from './tabs/RegisterTab'
import AccountsTab from './tabs/AccountsTab'
import ProxiesTab from './tabs/ProxiesTab'
import BrowsersTab from './tabs/BrowsersTab'
import TargetSitesTab from './tabs/TargetSitesTab'
import SettingsTab from './tabs/SettingsTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import LogsTab from './tabs/LogsTab'
import { Button, Field, Input } from './components/ui'
import {
  BrowserIcon,
  AlertTriangleIcon,
  GlobeIcon,
  MoonIcon,
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  ZapIcon,
  type IconProps
} from './components/ui/Icons'

type Tab = 'register' | 'targets' | 'accounts' | 'apiKeys' | 'logs' | 'proxies' | 'browsers' | 'settings'
type AppTheme = 'light' | 'night'

const TABS: { id: Tab; label: string; icon: (props: IconProps) => JSX.Element }[] = [
  { id: 'register', label: 'Register', icon: RocketIcon },
  { id: 'targets', label: 'Target Sites', icon: GlobeIcon },
  { id: 'accounts', label: 'Accounts', icon: UsersIcon },
  { id: 'apiKeys', label: 'API Keys', icon: ServerIcon },
  { id: 'logs', label: 'Logs', icon: AlertTriangleIcon },
  { id: 'proxies', label: 'Proxies', icon: GlobeIcon },
  { id: 'browsers', label: 'Browsers', icon: BrowserIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('register')
  const [otpRequest, setOtpRequest] = useState<ManualOtpRequest | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [submittingOtp, setSubmittingOtp] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null)
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('app-theme')
    return saved === 'light' || saved === 'night' ? saved : 'night'
  })

  useEffect(() => {
    localStorage.setItem('app-theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    return window.electronAPI.onManualOtpRequest((request) => {
      setOtpRequest(request)
      setOtpCode('')
      setOtpError('')
    })
  }, [])

  useEffect(() => {
    let mounted = true
    void window.electronAPI.getAppVersion().then((version) => {
      if (mounted) setAppVersion(version)
    })

    void window.electronAPI.getUpdateState().then((state) => {
      if (!mounted) return
      setUpdateState(state)
      if (state.currentVersion) setAppVersion(state.currentVersion)
    })

    const off = window.electronAPI.onUpdateState((state) => {
      setUpdateState(state)
      if (state.currentVersion) setAppVersion(state.currentVersion)
      if (state.status === 'available') {
        // Auto kick off the download as soon as we know an update exists.
        void window.electronAPI.downloadUpdate()
      }
    })

    // Kick off a check on launch.
    void window.electronAPI.checkForUpdateLive().then((state) => {
      if (!mounted) return
      setUpdateState(state)
      if (state.status === 'available') {
        void window.electronAPI.downloadUpdate()
      }
    })

    return () => {
      mounted = false
      off()
    }
  }, [])

  async function handleSubmitOtp(): Promise<void> {
    if (!otpRequest) return

    const code = otpCode.trim()
    if (!code) {
      setOtpError('OTP code is required')
      return
    }

    setSubmittingOtp(true)
    setOtpError('')
    try {
      await window.electronAPI.submitManualOtp(otpRequest.requestId, code)
      setOtpRequest(null)
      setOtpCode('')
    } catch (err) {
      setOtpError(String(err))
    } finally {
      setSubmittingOtp(false)
    }
  }

  async function handleCheckUpdate(): Promise<void> {
    const state = await window.electronAPI.checkForUpdateLive()
    setUpdateState(state)
    if (state.status === 'available') {
      void window.electronAPI.downloadUpdate()
    }
  }

  async function handleInstallNow(): Promise<void> {
    await window.electronAPI.quitAndInstallUpdate()
  }

  function renderUpdateRow(): JSX.Element {
    const status = updateState?.status ?? 'idle'
    const latest = updateState?.latestVersion
    const progress = updateState?.progress
    const fallbackUrl =
      updateState?.releaseUrl || 'https://github.com/coolbirdzik/auto-register-all/releases'

    if (status === 'checking') {
      return <span className="update-text">Checking for update...</span>
    }

    if (status === 'downloading' && progress) {
      return (
        <div className="update-progress">
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="update-text">
            {progress.percent}% · {formatBytes(progress.transferred)} /{' '}
            {formatBytes(progress.total)}
          </span>
        </div>
      )
    }

    if (status === 'downloaded') {
      return (
        <button
          className="link-button update-install"
          onClick={() => void handleInstallNow()}
          title={latest ? `Install v${latest} and restart` : 'Install update and restart'}
        >
          Restart & install v{latest}
        </button>
      )
    }

    if (status === 'available') {
      return (
        <span className="update-text" title={updateState?.releaseName || ''}>
          New v{latest} found, downloading...
        </span>
      )
    }

    if (status === 'error') {
      return (
        <button
          className="link-button"
          onClick={() => void window.electronAPI.openExternalUrl(fallbackUrl)}
          title={updateState?.error || 'Update error'}
        >
          Update failed - open releases
        </button>
      )
    }

    return (
      <button className="link-button" onClick={() => void handleCheckUpdate()}>
        Check update
      </button>
    )
  }

  return (
    <div className="app" data-theme={theme}>
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-logo">
            <ZapIcon size={22} />
          </span>
          <div>
            <div className="brand-title">Auto Register</div>
            <div className="brand-subtitle">Multi-site</div>
          </div>
        </div>

        <div className="nav">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                className={`nav-item ${tab === t.id ? 'active' : ''}`.trim()}
                onClick={() => setTab(t.id)}
              >
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
                <span className="nav-label">{t.label}</span>
              </button>
            )
          })}
        </div>

        <div className="sidebar-footer">
          <Button
            variant="secondary"
            size="sm"
            className="theme-toggle"
            icon={theme === 'night' ? <MoonIcon size={14} /> : <SunIcon size={14} />}
            onClick={() => setTheme((current) => (current === 'night' ? 'light' : 'night'))}
          >
            {theme === 'night' ? 'Night' : 'Light'}
          </Button>
          <span className="status-dot" />
          <span>Ready · v{appVersion || '...'}</span>
          {renderUpdateRow()}
        </div>
      </nav>

      <main className="content">
        <div className="content-inner">
          <div hidden={tab !== 'register'}>
            <RegisterTab />
          </div>
          <div hidden={tab !== 'targets'}>
            <TargetSitesTab />
          </div>
          <div hidden={tab !== 'accounts'}>
            <AccountsTab />
          </div>
          <div hidden={tab !== 'apiKeys'}>
            <ApiKeysTab />
          </div>
          <div hidden={tab !== 'logs'}>
            <LogsTab />
          </div>
          <div hidden={tab !== 'proxies'}>
            <ProxiesTab />
          </div>
          <div hidden={tab !== 'browsers'}>
            <BrowsersTab />
          </div>
          <div hidden={tab !== 'settings'}>
            <SettingsTab />
          </div>
        </div>
      </main>

      {otpRequest && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="otp-modal-title">
            <div className="modal-header">
              <h2 id="otp-modal-title" className="modal-title">
                Enter Verification Code
              </h2>
              <p className="modal-subtitle">{otpRequest.email}</p>
            </div>
            <div className="modal-body">
              <Field label="OTP Code">
                <Input
                  autoFocus
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSubmitOtp()
                  }}
                />
              </Field>
              {otpError && <div className="field-error">{otpError}</div>}
            </div>
            <div className="modal-actions">
              <Button
                variant="primary"
                loading={submittingOtp}
                onClick={() => void handleSubmitOtp()}
              >
                Submit OTP
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
