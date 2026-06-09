import { useEffect, useState } from 'react'
import type { AccountRecord } from '../../shared/contracts'
import {
  Button,
  Card,
  Checkbox,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EmptyState,
  Field,
  Input,
  PlayIcon,
  RefreshIcon,
  Select,
  ServerIcon
} from '../components/ui'

export default function ApiKeysTab(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState(`key-${Date.now()}`)
  const [unlimitedQuota, setUnlimitedQuota] = useState(true)
  const [remainQuota, setRemainQuota] = useState(0)
  const [expiredTime, setExpiredTime] = useState(-1)
  const [group, setGroup] = useState('')
  const [modelLimitsEnabled, setModelLimitsEnabled] = useState(false)
  const [modelLimits, setModelLimits] = useState('')
  const [allowIps, setAllowIps] = useState('')
  const [crossGroupRetry, setCrossGroupRetry] = useState(false)
  const [skipExisting, setSkipExisting] = useState(true)
  const [running, setRunning] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const accs = await window.electronAPI.getAccounts({ status: 'success' })
    const newApiAccounts = accs.filter((account) => account.siteId === 'tokenlb').reverse()
    setAccounts(newApiAccounts)
    setAccountId((current) => current || newApiAccounts[0]?.id || '')
  }

  async function handleCreate(): Promise<void> {
    if (!accountId) return
    const keyName = name.trim()
    if (!keyName) {
      setError('API key name is required')
      return
    }

    setRunning(true)
    setError('')
    setMessage('')
    try {
      const result = await window.electronAPI.createNewApiKey({
        accountId,
        name: keyName,
        unlimitedQuota,
        remainQuota,
        expiredTime,
        group,
        modelLimitsEnabled,
        modelLimits,
        allowIps,
        crossGroupRetry
      })
      setAccounts((prev) => prev.map((account) => (account.id === result.account.id ? result.account : account)))
      setMessage(`Created API key ${result.token.name} for ${result.account.username || result.account.email}`)
      setName(`key-${Date.now()}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }

  async function handleCreateAll(): Promise<void> {
    const baseName = name.trim()
    if (!baseName) {
      setError('API key name is required')
      return
    }

    const targets = accounts.filter((account) => !skipExisting || !account.apiKey)
    if (targets.length === 0) {
      setMessage('No accounts to create. Disable skip existing to recreate keys.')
      return
    }

    setBulkRunning(true)
    setError('')
    setMessage('')
    setBulkProgress(`0/${targets.length}`)

    let success = 0
    const failures: string[] = []
    try {
      for (let i = 0; i < targets.length; i++) {
        const account = targets[i]
        const accountLabel = account.username || account.email || account.id
        setBulkProgress(`${i + 1}/${targets.length}: ${accountLabel}`)

        try {
          const result = await window.electronAPI.createNewApiKey({
            accountId: account.id,
            name: buildBulkKeyName(baseName, account, i),
            unlimitedQuota,
            remainQuota,
            expiredTime,
            group,
            modelLimitsEnabled,
            modelLimits,
            allowIps,
            crossGroupRetry
          })
          success += 1
          setAccounts((prev) => prev.map((item) => (item.id === result.account.id ? result.account : item)))
        } catch (err) {
          failures.push(`${accountLabel}: ${String(err)}`)
        }
      }

      setMessage(`Created API keys for ${success}/${targets.length} account(s).`)
      if (failures.length > 0) {
        setError(failures.slice(0, 3).join('\n'))
      }
    } finally {
      setBulkRunning(false)
      setBulkProgress('')
      void load()
    }
  }

  function buildBulkKeyName(baseName: string, account: AccountRecord, index: number): string {
    const suffix = (account.username || account.email || String(index + 1))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `${baseName}-${suffix || index + 1}`
  }

  function handleCopy(id: string, value: string): void {
    if (!value) return
    void navigator.clipboard.writeText(value)
    setCopiedId(id)
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1200)
  }

  function handleExport(): void {
    const lines = accounts
      .filter((account) => account.apiKey)
      .map((account) => `${account.username || account.email || account.id}|${account.apiKey}`)
    if (lines.length === 0) {
      setError('No API keys to export')
      return
    }

    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `api-keys-${Date.now()}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setMessage(`Exported ${lines.length} API key(s).`)
  }

  const selectedAccount = accounts.find((account) => account.id === accountId)

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">API Keys</h1>
        <p className="page-subtitle">Create New API keys for registered site accounts and save them back to Accounts.</p>
      </header>

      {accounts.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<ServerIcon size={26} />}
            title="No New API accounts"
            description="Register a TokenLB account first, then create an API key from this tab."
          />
        </Card>
      ) : (
        <>
          <Card title="Create Key" icon={<ServerIcon size={18} />}>
            <div className="form-grid">
              <Field label="Account">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.username || account.email} {account.apiKey ? '(has key)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Key Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Remain Quota">
                <Input
                  type="number"
                  value={remainQuota}
                  disabled={unlimitedQuota}
                  onChange={(e) => setRemainQuota(Number(e.target.value))}
                />
              </Field>
              <Field label="Expired Time">
                <Input type="number" value={expiredTime} onChange={(e) => setExpiredTime(Number(e.target.value))} />
              </Field>
              <Field label="Group">
                <Input value={group} placeholder="default" onChange={(e) => setGroup(e.target.value)} />
              </Field>
              <Field label="Allow IPs">
                <Input value={allowIps} placeholder="comma separated" onChange={(e) => setAllowIps(e.target.value)} />
              </Field>
              <Field label="Unlimited Quota">
                <Checkbox
                  label="Use unlimited quota"
                  checked={unlimitedQuota}
                  onChange={(e) => setUnlimitedQuota(e.target.checked)}
                />
              </Field>
              <Field label="Model Limits">
                <Checkbox
                  label="Enable model limits"
                  checked={modelLimitsEnabled}
                  onChange={(e) => setModelLimitsEnabled(e.target.checked)}
                />
              </Field>
              {modelLimitsEnabled && (
                <Field label="Models">
                  <Input value={modelLimits} placeholder="gpt-4,gpt-4o" onChange={(e) => setModelLimits(e.target.value)} />
                </Field>
              )}
              <Field label="Cross Group Retry">
                <Checkbox
                  label="Retry across groups"
                  checked={crossGroupRetry}
                  onChange={(e) => setCrossGroupRetry(e.target.checked)}
                />
              </Field>
              <Field label="Bulk Mode">
                <Checkbox
                  label="Skip accounts that already have an API key"
                  checked={skipExisting}
                  onChange={(e) => setSkipExisting(e.target.checked)}
                />
              </Field>
            </div>

            {selectedAccount && (
              <p className="cell-secondary">
                Uses browser profile from this account. If the session expired, the profile opens so you can log in at
                /sign-in and retry.
              </p>
            )}
            {error && <div className="field-error">{error}</div>}
            {message && <div className="field-success">{message}</div>}
            {bulkProgress && <div className="cell-secondary">Bulk progress: {bulkProgress}</div>}
            <div className="actions">
              <Button
                variant="primary"
                loading={running}
                disabled={bulkRunning}
                icon={<PlayIcon size={16} />}
                onClick={() => void handleCreate()}
              >
                Create API Key
              </Button>
              <Button
                variant="secondary"
                loading={bulkRunning}
                disabled={running}
                icon={<PlayIcon size={16} />}
                onClick={() => void handleCreateAll()}
              >
                Create For All
              </Button>
              <Button variant="ghost" icon={<RefreshIcon size={15} />} onClick={() => void load()}>
                Refresh
              </Button>
              <Button variant="secondary" icon={<DownloadIcon size={15} />} onClick={handleExport}>
                Export TXT
              </Button>
            </div>
          </Card>

          <Card title="Saved Keys" icon={<ServerIcon size={18} />} flush>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Email</th>
                    <th>API Key</th>
                    <th>Name</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="mono">{account.username || '-'}</td>
                      <td className="mono">{account.email || '-'}</td>
                      <td>
                        <span className="password-cell">
                          <span className="password-value">{account.apiKey || '-'}</span>
                          {account.apiKey && (
                            <button className="icon-btn" title="Copy API key" onClick={() => handleCopy(account.id, account.apiKey || '')}>
                              {copiedId === account.id ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
                            </button>
                          )}
                        </span>
                      </td>
                      <td>{account.apiKeyName || '-'}</td>
                      <td className="cell-secondary">
                        {account.apiKeyCreatedAt ? new Date(account.apiKeyCreatedAt).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
