import { useEffect, useState } from 'react'
import type { AppSettings, EmailMeta, SiteMeta } from '../../shared/contracts'
import ConfigForm from '../components/ConfigForm'
import {
  AlertTriangleIcon,
  Button,
  Card,
  CheckCircleIcon,
  CheckIcon,
  Checkbox,
  Field,
  GlobeIcon,
  InboxIcon,
  Input,
  Select,
  SettingsIcon,
  Spinner
} from '../components/ui'

export default function SettingsTab(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sites, setSites] = useState<SiteMeta[]>([])
  const [emails, setEmails] = useState<EmailMeta[]>([])
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const [st, s, e] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.listSites(),
      window.electronAPI.listEmailProviders()
    ])
    setSettings(st)
    setSites(s)
    setEmails(e)
  }

  async function handleSave(): Promise<void> {
    if (!settings) return
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function updateEmailConfig(providerId: string, key: string, value: unknown): void {
    if (!settings) return
    setSettings({
      ...settings,
      emailProviders: {
        ...settings.emailProviders,
        [providerId]: { ...settings.emailProviders[providerId], [key]: value }
      }
    })
  }

  function updateSiteConfig(siteId: string, key: string, value: unknown): void {
    if (!settings) return
    setSettings({
      ...settings,
      siteConfigs: {
        ...settings.siteConfigs,
        [siteId]: { ...settings.siteConfigs[siteId], [key]: value }
      }
    })
  }

  async function handleTestEmail(providerId: string): Promise<void> {
    setTestingId(providerId)
    setTestResult('Testing...')
    try {
      const result = await window.electronAPI.testEmailProvider(providerId)
      setTestResult(result.success ? `Generated: ${result.email}` : `Failed: ${result.error}`)
    } catch (err) {
      setTestResult(`Error: ${String(err)}`)
    } finally {
      setTestingId(null)
    }
  }

  if (!settings) {
    return (
      <div className="loading-screen">
        <Spinner size={22} />
        <span>Loading settings...</span>
      </div>
    )
  }

  const isTesting = testResult === 'Testing...'
  const isSuccess = testResult.startsWith('Generated')
  const noticeTone = isTesting ? 'notice-info' : isSuccess ? 'notice-success' : 'notice-danger'

  return (
    <>
      <header className="page-header page-header-split">
        <div className="page-header-meta">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure providers, sites, and default job behavior.</p>
        </div>
        <Button
          variant="primary"
          icon={saved ? <CheckIcon size={16} /> : undefined}
          onClick={() => void handleSave()}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>
      </header>

      <Card title="Default Job Options" icon={<SettingsIcon size={18} />} className="settings-primary-card">
        <div className="form-grid settings-compact-grid">
          <Field label="Default Site">
            <Select
              value={settings.defaults.siteId}
              onChange={(e) =>
                setSettings({ ...settings, defaults: { ...settings.defaults, siteId: e.target.value } })
              }
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Default Email Provider">
            <Select
              value={settings.defaults.emailProviderId}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: { ...settings.defaults, emailProviderId: e.target.value }
                })
              }
            >
              {emails.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Max Concurrent">
            <Input
              type="number"
              min={1}
              max={10}
              value={settings.defaults.maxConcurrent}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: { ...settings.defaults, maxConcurrent: Number(e.target.value) }
                })
              }
            />
          </Field>

          <Field label="Inter-job Delay (ms)">
            <Input
              type="number"
              min={0}
              value={settings.defaults.interJobDelayMs}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: { ...settings.defaults, interJobDelayMs: Number(e.target.value) }
                })
              }
            />
          </Field>

          <Field
            label="Continuous Run"
            hint="When enabled, new registration jobs keep starting until you cancel the batch."
          >
            <Checkbox
              label="Create accounts continuously by default"
              checked={settings.defaults.continuousRun}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: { ...settings.defaults, continuousRun: e.target.checked }
                })
              }
            />
          </Field>

          <Field label="API Routing">
            <Checkbox
              label="Use proxy for API calls"
              checked={settings.defaults.useProxyForApi}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaults: { ...settings.defaults, useProxyForApi: e.target.checked }
                })
              }
            />
          </Field>
        </div>
      </Card>

      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Email Providers</h2>
            <p className="settings-section-subtitle">Inbox sources, API keys, and mailbox behavior.</p>
          </div>
        </div>

        {testResult && (
          <div className={`notice ${noticeTone}`}>
            {isTesting ? (
              <Spinner size={15} />
            ) : isSuccess ? (
              <CheckCircleIcon size={16} />
            ) : (
              <AlertTriangleIcon size={16} />
            )}
            <span>{testResult}</span>
          </div>
        )}

        <div className="settings-grid">
          {emails.map((email) => (
            <Card
              title={email.name}
              subtitle="Email provider"
              icon={<InboxIcon size={18} />}
              key={email.id}
              className="settings-card"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={testingId === email.id}
                  onClick={() => void handleTestEmail(email.id)}
                >
                  Test Connection
                </Button>
              }
            >
              <div className="form-grid settings-compact-grid">
                <ConfigForm
                  schema={email.configSchema}
                  values={settings.emailProviders[email.id] ?? {}}
                  onChange={(key, value) => updateEmailConfig(email.id, key, value)}
                />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Target Sites</h2>
            <p className="settings-section-subtitle">Base URLs, login paths, delays, and site-specific defaults.</p>
          </div>
        </div>

        <div className="settings-grid">
          {sites.map((site) => (
            <Card
              title={site.name}
              subtitle="Target site"
              icon={<GlobeIcon size={18} />}
              key={site.id}
              className="settings-card"
            >
              <div className="form-grid settings-compact-grid">
                <ConfigForm
                  schema={site.configSchema}
                  values={settings.siteConfigs[site.id] ?? {}}
                  onChange={(key, value) => updateSiteConfig(site.id, key, value)}
                />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  )
}
