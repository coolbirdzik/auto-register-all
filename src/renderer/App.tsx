import { useEffect, useState } from 'react'
import type { AppUpdateInfo, ManualOtpRequest } from '../shared/contracts'
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
  RocketIcon,
  ServerIcon,
  SettingsIcon,
  UsersIcon,
  ZapIcon,
  type IconProps
} from './components/ui/Icons'

type Tab = 'register' | 'targets' | 'accounts' | 'apiKeys' | 'logs' | 'proxies' | 'browsers' | 'settings'

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

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('register')
  const [otpRequest, setOtpRequest] = useState<ManualOtpRequest | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [submittingOtp, setSubmittingOtp] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')

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
    void window.electronAPI.checkForUpdate().then((info) => {
      if (mounted) {
        setUpdateInfo(info)
        setAppVersion(info.currentVersion)
      }
    })
    return () => {
      mounted = false
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
    setCheckingUpdate(true)
    setUpdateMessage('')
    try {
      const info = await window.electronAPI.checkForUpdate()
      setUpdateInfo(info)
      setAppVersion(info.currentVersion)
      if (info.error) {
        setUpdateMessage('Update check failed')
      } else if (info.updateAvailable) {
        setUpdateMessage(`New version v${info.latestVersion}`)
      } else {
        setUpdateMessage('Up to date')
      }
    } catch {
      setUpdateMessage('Update check failed')
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="app">
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
          <span className="status-dot" />
          <span>Ready · v{appVersion || '...'}</span>
          {updateInfo?.updateAvailable && updateInfo.releaseUrl && (
            <button
              className="link-button"
              title={updateInfo.releaseName || `Version ${updateInfo.latestVersion}`}
              onClick={() => void window.electronAPI.openExternalUrl(updateInfo.releaseUrl || 'https://github.com/coolbirdzik/auto-register-all/releases')}
            >
              Update v{updateInfo.latestVersion}
            </button>
          )}
          <button className="link-button" disabled={checkingUpdate} onClick={() => void handleCheckUpdate()}>
            {checkingUpdate ? 'Checking...' : 'Check update'}
          </button>
          {updateMessage && <span>{updateMessage}</span>}
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
