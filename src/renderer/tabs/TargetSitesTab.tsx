import { useEffect, useState } from 'react'
import type { AppSettings, TargetSiteConfig } from '../../shared/contracts'
import { Button, Card, Field, GlobeIcon, Input, PlusIcon, TrashIcon } from '../components/ui'

function createTarget(): TargetSiteConfig {
  return {
    id: crypto.randomUUID(),
    label: '',
    providerId: 'tokenlb',
    startUrl: '',
    enabled: true,
    createdAt: new Date().toISOString()
  }
}

function normalizeUrl(value: string): string {
  const text = value.trim()
  if (!text) return ''
  return new URL(text).toString()
}

export default function TargetSitesTab(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState<TargetSiteConfig>(() => createTarget())
  const [message, setMessage] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const st = await window.electronAPI.getSettings()
    setSettings(st)
    setDraft(createTarget())
  }

  async function saveTargets(nextTargets: TargetSiteConfig[], nextDefaultId?: string): Promise<void> {
    if (!settings) return
    const defaultTargetId = nextDefaultId ?? settings.defaults.targetSiteId
    const defaultTarget = nextTargets.find((target) => target.id === defaultTargetId)
    const nextSettings = {
      ...settings,
      targetSites: nextTargets,
      defaults: {
        ...settings.defaults,
        siteId: defaultTarget?.providerId ?? settings.defaults.siteId,
        targetSiteId: defaultTargetId
      }
    }
    setSettings(nextSettings)
    await window.electronAPI.saveSettings({
      targetSites: nextSettings.targetSites,
      defaults: nextSettings.defaults
    })
  }

  async function handleAdd(): Promise<void> {
    if (!settings) return
    try {
      const startUrl = normalizeUrl(draft.startUrl)
      const label = draft.label.trim()
      if (!label) throw new Error('Target name is required')
      if (!startUrl) throw new Error('Start link is required')

      const nextTarget: TargetSiteConfig = {
        ...draft,
        label,
        providerId: 'tokenlb',
        startUrl
      }
      const nextTargets = [...settings.targetSites, nextTarget]
      await saveTargets(nextTargets, settings.defaults.targetSiteId ?? nextTarget.id)
      setDraft(createTarget())
      setMessage('Target site added')
    } catch (err) {
      setMessage(String(err))
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!settings) return
    if (!confirm('Delete this target site?')) return
    const nextTargets = settings.targetSites.filter((target) => target.id !== id)
    const nextDefault =
      settings.defaults.targetSiteId === id ? nextTargets[0]?.id : settings.defaults.targetSiteId
    await saveTargets(nextTargets, nextDefault)
  }

  async function handleSetDefault(id: string): Promise<void> {
    if (!settings) return
    await saveTargets(settings.targetSites, id)
  }

  async function handleToggle(id: string): Promise<void> {
    if (!settings) return
    const nextTargets = settings.targetSites.map((target) =>
      target.id === id ? { ...target, enabled: !target.enabled } : target
    )
    await saveTargets(nextTargets)
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Target Sites</h1>
        <p className="page-subtitle">Manage reusable registration targets and their start links.</p>
      </header>

      <Card title="Add Target Site" icon={<PlusIcon size={18} />}>
        <div className="form-grid">
          <Field label="Name">
            <Input
              value={draft.label}
              placeholder="Main target"
              onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
            />
          </Field>
          <Field label="Start Link">
            <Input
              value={draft.startUrl}
              placeholder="https://example.com/sign-up"
              onChange={(e) => setDraft((prev) => ({ ...prev, startUrl: e.target.value }))}
            />
          </Field>
        </div>
        <div className="actions">
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => void handleAdd()}>
            Add Target
          </Button>
          {message && <span className="field-hint">{message}</span>}
        </div>
      </Card>

      <Card flush>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Start Link</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(settings?.targetSites ?? []).map((target) => (
                <tr key={target.id}>
                  <td>
                    <div>{target.label}</div>
                    {settings?.defaults.targetSiteId === target.id && (
                      <div className="cell-secondary">Default target</div>
                    )}
                  </td>
                  <td className="mono">{target.startUrl}</td>
                  <td>{target.enabled ? 'Enabled' : 'Disabled'}</td>
                  <td>
                    <div className="cell-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleSetDefault(target.id)}
                      >
                        Use
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void handleToggle(target.id)}>
                        {target.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <button
                        className="icon-btn danger"
                        title="Delete target"
                        onClick={() => void handleDelete(target.id)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(settings?.targetSites ?? []).length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <GlobeIcon size={24} />
                      </div>
                      <div className="empty-state-title">No target sites</div>
                      <div className="empty-state-desc">Add a start link above before running jobs.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
