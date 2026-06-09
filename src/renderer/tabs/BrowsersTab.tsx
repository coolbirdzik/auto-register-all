import { useEffect, useState } from 'react'
import type { BrowserProfile, ProxyConfig } from '../../shared/contracts'
import {
  BrowserIcon,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PlusIcon,
  Select,
  TrashIcon
} from '../components/ui'

export default function BrowsersTab(): JSX.Element {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([])
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newProxyId, setNewProxyId] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const [p, pr] = await Promise.all([
      window.electronAPI.listBrowserProfiles(),
      window.electronAPI.listProxies()
    ])
    setProfiles(p)
    setProxies(pr)
  }

  async function handleCreate(): Promise<void> {
    await window.electronAPI.createBrowserProfile({
      label: newLabel || `Browser ${profiles.length + 1}`,
      proxyId: newProxyId || undefined,
      visible: false
    })
    setNewLabel('')
    setNewProxyId('')
    void load()
  }

  async function handleShow(id: string): Promise<void> {
    await window.electronAPI.showBrowserProfile(id)
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this browser profile?')) return
    await window.electronAPI.deleteBrowserProfile(id)
    void load()
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Browser Profiles</h1>
        <p className="page-subtitle">Persistent browser identities for fixed and rotating sessions.</p>
      </header>

      <Card title="Create Profile" icon={<PlusIcon size={18} />}>
        <div className="form-row">
          <Field label="Label" className="grow">
            <Input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={`Browser ${profiles.length + 1}`}
            />
          </Field>
          <Field label="Proxy" className="grow">
            <Select value={newProxyId} onChange={(e) => setNewProxyId(e.target.value)}>
              <option value="">Direct (no proxy)</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => void handleCreate()}>
            Create
          </Button>
        </div>
      </Card>

      {profiles.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<BrowserIcon size={26} />}
            title="No browser profiles"
            description="Create a profile to use the fixed or rotate browser modes during registration."
          />
        </Card>
      ) : (
        <Card flush>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Partition</th>
                  <th>Proxy</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const proxy = proxies.find((pr) => pr.id === p.proxyId)
                  return (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td className="mono cell-secondary">{p.partition}</td>
                      <td>{proxy?.label ?? <span className="cell-secondary">Direct</span>}</td>
                      <td className="cell-secondary">{new Date(p.createdAt).toLocaleString()}</td>
                      <td>
                        <div className="cell-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={<BrowserIcon size={15} />}
                            onClick={() => void handleShow(p.id)}
                          >
                            Show Window
                          </Button>
                          <button
                            className="icon-btn danger"
                            title="Delete profile"
                            onClick={() => void handleDelete(p.id)}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
