import { useEffect, useState } from 'react'
import type { AccountRecord, BrowserProfile, ProxyConfig, SiteMeta } from '../../shared/contracts'
import {
  Badge,
  Button,
  Card,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EmptyState,
  EyeIcon,
  EyeOffIcon,
  Field,
  Input,
  PlusIcon,
  RefreshIcon,
  Select,
  Textarea,
  TrashIcon,
  UsersIcon,
  XCircleIcon
} from '../components/ui'

interface ManualAccountForm {
  siteId: string
  username: string
  password: string
  email: string
  browserProfileId: string
  proxyId: string
  apiKey: string
  apiKeyName: string
  apiKeyId: string
  notes: string
}

const EMPTY_MANUAL_FORM: ManualAccountForm = {
  siteId: '',
  username: '',
  password: '',
  email: '',
  browserProfileId: '',
  proxyId: '',
  apiKey: '',
  apiKeyName: '',
  apiKeyId: '',
  notes: ''
}

export default function AccountsTab(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [sites, setSites] = useState<SiteMeta[]>([])
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfile[]>([])
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [filterSite, setFilterSite] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [manualForm, setManualForm] = useState<ManualAccountForm>(EMPTY_MANUAL_FORM)
  const [manualError, setManualError] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  useEffect(() => {
    void load()
  }, [filterSite, filterStatus])

  async function load(): Promise<void> {
    const [accs, siteList, profiles, proxyList] = await Promise.all([
      window.electronAPI.getAccounts({
        siteId: filterSite || undefined,
        status: (filterStatus as 'success' | 'failed') || undefined
      }),
      window.electronAPI.listSites(),
      window.electronAPI.listBrowserProfiles(),
      window.electronAPI.listProxies()
    ])
    setAccounts(accs.reverse())
    setSelected(new Set())
    setSites(siteList)
    setBrowserProfiles(profiles)
    setProxies(proxyList)
  }

  function openAddModal(): void {
    setManualForm({
      ...EMPTY_MANUAL_FORM,
      siteId: filterSite || sites[0]?.id || ''
    })
    setManualError('')
    setShowAddModal(true)
  }

  function closeAddModal(): void {
    if (manualSaving) return
    setShowAddModal(false)
    setManualError('')
  }

  function updateManualForm<K extends keyof ManualAccountForm>(
    key: K,
    value: ManualAccountForm[K]
  ): void {
    setManualForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleManualSubmit(): Promise<void> {
    const siteId = manualForm.siteId.trim()
    const username = manualForm.username.trim()
    const password = manualForm.password
    if (!siteId) {
      setManualError('Select a site')
      return
    }
    if (!username) {
      setManualError('Username is required')
      return
    }
    if (!password) {
      setManualError('Password is required')
      return
    }

    let apiKeyId: number | undefined
    const apiKeyIdRaw = manualForm.apiKeyId.trim()
    if (apiKeyIdRaw) {
      const parsed = Number(apiKeyIdRaw)
      if (!Number.isFinite(parsed)) {
        setManualError('API key id must be a number')
        return
      }
      apiKeyId = parsed
    }

    setManualSaving(true)
    setManualError('')
    try {
      await window.electronAPI.addAccount({
        siteId,
        username,
        password,
        email: manualForm.email.trim() || undefined,
        browserProfileId: manualForm.browserProfileId || undefined,
        proxyId: manualForm.proxyId || undefined,
        apiKey: manualForm.apiKey.trim() || undefined,
        apiKeyName: manualForm.apiKeyName.trim() || undefined,
        apiKeyId,
        notes: manualForm.notes.trim() || undefined
      })
      setShowAddModal(false)
      await load()
    } catch (err) {
      setManualError(err instanceof Error ? err.message : String(err))
    } finally {
      setManualSaving(false)
    }
  }

  async function handleExport(successOnly = false): Promise<void> {
    const result = await window.electronAPI.exportAccounts({
      filter: {
        siteId: filterSite || undefined,
        status: (filterStatus as 'success' | 'failed') || undefined
      },
      successOnly
    })
    if (!result.canceled && result.path) {
      alert(`Exported to ${result.path}`)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this account record?')) return
    await window.electronAPI.deleteAccount(id)
    void load()
  }

  async function handleBulkDelete(): Promise<void> {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} selected account record(s)?`)) return
    await window.electronAPI.deleteAccounts(ids)
    void load()
  }

  function toggleSelected(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible(): void {
    setSelected((prev) => {
      if (accounts.length > 0 && accounts.every((a) => prev.has(a.id))) {
        return new Set()
      }
      return new Set(accounts.map((a) => a.id))
    })
  }

  function toggleReveal(id: string): void {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleCopy(id: string, value: string): void {
    if (!value) return
    void navigator.clipboard.writeText(value)
    setCopiedId(id)
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  const successCount = accounts.filter((a) => a.status === 'success').length
  const failCount = accounts.filter((a) => a.status === 'failed').length
  const allVisibleSelected = accounts.length > 0 && accounts.every((a) => selected.has(a.id))

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Accounts</h1>
        <p className="page-subtitle">Browse, export, and manage registered accounts.</p>
      </header>

      <div className="stats">
        <div className="stat-card">
          <span className="stat-icon neutral">
            <UsersIcon size={20} />
          </span>
          <div>
            <div className="stat-value">{accounts.length}</div>
            <div className="stat-label">Total</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon success">
            <CheckCircleIcon size={20} />
          </span>
          <div>
            <div className="stat-value">{successCount}</div>
            <div className="stat-label">Success</div>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon danger">
            <XCircleIcon size={20} />
          </span>
          <div>
            <div className="stat-value">{failCount}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <Field label="Site">
          <Select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
            <option value="">All</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </Select>
        </Field>
        <div className="toolbar-spacer" />
        <div className="actions actions-inline">
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={openAddModal}>
            Add Account
          </Button>
          <Button variant="secondary" icon={<DownloadIcon size={15} />} onClick={() => void handleExport(false)}>
            Export All
          </Button>
          <Button variant="secondary" icon={<DownloadIcon size={15} />} onClick={() => void handleExport(true)}>
            Export Success
          </Button>
          <Button
            variant="danger"
            icon={<TrashIcon size={15} />}
            disabled={selected.size === 0}
            onClick={() => void handleBulkDelete()}
          >
            Delete Selected ({selected.size})
          </Button>
          <Button variant="ghost" icon={<RefreshIcon size={15} />} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<UsersIcon size={26} />}
            title="No accounts yet"
            description="Run a registration job and your generated accounts will appear here."
          />
        </Card>
      ) : (
        <Card flush>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all accounts"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th>Site</th>
                  <th>Username</th>
                  <th>Password</th>
                  <th>API Key</th>
                  <th>Email</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const isRevealed = revealed.has(a.id)
                  return (
                    <tr key={a.id}>
                      <td className="select-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.username || a.email || a.id}`}
                          checked={selected.has(a.id)}
                          onChange={() => toggleSelected(a.id)}
                        />
                      </td>
                      <td>{a.siteName}</td>
                      <td className="mono">{a.username || '—'}</td>
                      <td>
                        <span className="password-cell">
                          <span className={`password-value ${isRevealed ? '' : 'masked'}`.trim()}>
                            {isRevealed ? a.password || '—' : '••••••••'}
                          </span>
                          <button
                            className="icon-btn"
                            title={isRevealed ? 'Hide password' : 'Reveal password'}
                            onClick={() => toggleReveal(a.id)}
                          >
                            {isRevealed ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                          </button>
                          <button
                            className="icon-btn"
                            title="Copy password"
                            onClick={() => handleCopy(a.id, a.password)}
                          >
                            {copiedId === a.id ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                          </button>
                        </span>
                      </td>
                      <td>
                        <span className="password-cell">
                          <span className="password-value">{a.apiKey || '—'}</span>
                          {a.apiKey && (
                            <button
                              className="icon-btn"
                              title="Copy API key"
                              onClick={() => handleCopy(`${a.id}:api-key`, a.apiKey || '')}
                            >
                              {copiedId === `${a.id}:api-key` ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="mono">{a.email || '—'}</td>
                      <td className="cell-secondary">{new Date(a.registeredAt).toLocaleString()}</td>
                      <td>
                        <div className="stack">
                          <Badge tone={a.status === 'success' ? 'success' : 'danger'} dot>
                            {a.status}
                          </Badge>
                          {a.error && <span className="cell-secondary">{a.error}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="cell-actions">
                          <button
                            className="icon-btn danger"
                            title="Delete record"
                            onClick={() => void handleDelete(a.id)}
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

      {showAddModal && (
        <div className="modal-backdrop" onClick={closeAddModal}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-account-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="add-account-title" className="modal-title">
                Add Account Manually
              </h2>
              <p className="modal-subtitle">
                Save existing credentials so you can create API keys and pull quota for them.
              </p>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <Field label="Site" className="grow">
                  <Select
                    value={manualForm.siteId}
                    onChange={(e) => updateManualForm('siteId', e.target.value)}
                  >
                    <option value="">Select a site</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Email" className="grow">
                  <Input
                    type="text"
                    value={manualForm.email}
                    onChange={(e) => updateManualForm('email', e.target.value)}
                    placeholder="user@example.com"
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Username" className="grow">
                  <Input
                    type="text"
                    value={manualForm.username}
                    onChange={(e) => updateManualForm('username', e.target.value)}
                    placeholder="login username"
                  />
                </Field>
                <Field label="Password" className="grow">
                  <Input
                    type="text"
                    value={manualForm.password}
                    onChange={(e) => updateManualForm('password', e.target.value)}
                    placeholder="login password"
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field
                  label="Browser Profile"
                  className="grow"
                  hint="Required to create API keys or fetch quota for this account."
                >
                  <Select
                    value={manualForm.browserProfileId}
                    onChange={(e) => updateManualForm('browserProfileId', e.target.value)}
                  >
                    <option value="">None</option>
                    {browserProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Proxy" className="grow">
                  <Select
                    value={manualForm.proxyId}
                    onChange={(e) => updateManualForm('proxyId', e.target.value)}
                  >
                    <option value="">Direct (no proxy)</option>
                    {proxies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="form-row">
                <Field label="API Key (optional)" className="grow">
                  <Input
                    type="text"
                    value={manualForm.apiKey}
                    onChange={(e) => updateManualForm('apiKey', e.target.value)}
                    placeholder="sk-..."
                  />
                </Field>
                <Field label="API Key Name" className="grow">
                  <Input
                    type="text"
                    value={manualForm.apiKeyName}
                    onChange={(e) => updateManualForm('apiKeyName', e.target.value)}
                    placeholder="key label"
                  />
                </Field>
                <Field label="API Key Id">
                  <Input
                    type="number"
                    value={manualForm.apiKeyId}
                    onChange={(e) => updateManualForm('apiKeyId', e.target.value)}
                    placeholder="numeric id"
                  />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <Textarea
                  rows={2}
                  value={manualForm.notes}
                  onChange={(e) => updateManualForm('notes', e.target.value)}
                  placeholder="Where this account came from, anything else worth remembering."
                />
              </Field>
              {manualError && <div className="field-error">{manualError}</div>}
            </div>
            <div className="modal-actions">
              <Button variant="ghost" onClick={closeAddModal} disabled={manualSaving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={manualSaving}
                onClick={() => void handleManualSubmit()}
              >
                Save Account
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
