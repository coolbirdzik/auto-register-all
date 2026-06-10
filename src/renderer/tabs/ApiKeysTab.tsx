import { useEffect, useState } from 'react'
import type { AccountRecord, ApiKeyGroupOption, SiteMeta } from '../../shared/contracts'
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
  KeyIcon,
  PlayIcon,
  RefreshIcon,
  Select,
  ServerIcon,
  TrendUpIcon,
  WalletIcon
} from '../components/ui'

const WEILAI_DEFAULT_GROUPS: ApiKeyGroupOption[] = [
  { id: 13, name: '余额', platform: 'openai', rateMultiplier: 0.06 },
  { id: 17, name: 'anthropic', platform: 'anthropic', rateMultiplier: 1.5 },
  { id: 19, name: '免费生图-生图请选择这个分组', platform: 'openai', rateMultiplier: 1 },
  { id: 21, name: 'claude特殊渠道', platform: 'anthropic', rateMultiplier: 0.6 },
  { id: 22, name: 'team', platform: 'openai', rateMultiplier: 0.01 }
]

export default function ApiKeysTab(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [sites, setSites] = useState<SiteMeta[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState(`key-${Date.now()}`)
  const [unlimitedQuota, setUnlimitedQuota] = useState(true)
  const [remainQuota, setRemainQuota] = useState(0)
  const [expiredTime, setExpiredTime] = useState(-1)
  const [group, setGroup] = useState('')
  const [groupOptions, setGroupOptions] = useState<ApiKeyGroupOption[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [modelLimitsEnabled, setModelLimitsEnabled] = useState(false)
  const [modelLimits, setModelLimits] = useState('')
  const [allowIps, setAllowIps] = useState('')
  const [crossGroupRetry, setCrossGroupRetry] = useState(false)
  const [skipExisting, setSkipExisting] = useState(true)
  const [running, setRunning] = useState(false)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [groupRunning, setGroupRunning] = useState(false)
  const [bulkGroupRunning, setBulkGroupRunning] = useState(false)
  const [bulkBalanceRunning, setBulkBalanceRunning] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [balanceRunningId, setBalanceRunningId] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportMinBalance, setExportMinBalance] = useState('')
  const [exportMaxBalance, setExportMaxBalance] = useState('')
  const [exportSkipNoBalance, setExportSkipNoBalance] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])

  const supportedSiteIds = new Set(['tokenlb', 'weilai-chat', 'ai-router'])
  const managedGroupSiteIds = new Set(['weilai-chat', 'ai-router'])
  const balanceSupportedSiteIds = new Set(['tokenlb', 'weilai-chat', 'ai-router'])

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const [accs, siteList] = await Promise.all([
      window.electronAPI.getAccounts({ status: 'success' }),
      window.electronAPI.listSites()
    ])
    const apiKeyAccounts = accs.filter((account) => supportedSiteIds.has(account.siteId)).reverse()
    setAccounts(apiKeyAccounts)
    setSites(siteList.filter((site) => supportedSiteIds.has(site.id)))
    setAccountId((current) => {
      if (current && apiKeyAccounts.some((account) => account.id === current)) return current
      return apiKeyAccounts[0]?.id || ''
    })
  }

  async function loadGroupOptions(targetAccountId: string): Promise<void> {
    if (!targetAccountId) return
    const targetAccount = accounts.find((account) => account.id === targetAccountId)
    if (targetAccount && !managedGroupSiteIds.has(targetAccount.siteId)) {
      setGroupOptions([])
      return
    }
    setGroupsLoading(true)
    try {
      const groups = await window.electronAPI.listApiKeyGroups({ accountId: targetAccountId })
      setGroupOptions(groups)
      setGroup((current) => {
        if (current && groups.some((item) => String(item.id) === current)) return current
        return String(groups.find((item) => item.name === 'team')?.id ?? groups[0]?.id ?? '')
      })
    } catch (err) {
      setGroupOptions([])
      setError(String(err))
    } finally {
      setGroupsLoading(false)
    }
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

    const targets = filteredAccounts.filter((account) => !skipExisting || !account.apiKey)
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

  async function handleUpdateGroup(targetAccountId = accountId): Promise<void> {
    const groupId = Number(group)
    if (!targetAccountId || !Number.isFinite(groupId) || groupId < 1) {
      setError('Select a valid group')
      return
    }

    setGroupRunning(true)
    setError('')
    setMessage('')
    try {
      const result = await window.electronAPI.updateApiKeyGroup({ accountId: targetAccountId, groupId })
      setAccounts((prev) => prev.map((account) => (account.id === result.account.id ? result.account : account)))
      setMessage(
        `Updated group for ${result.account.username || result.account.email}: ${result.group.name} (${result.group.platform}, ${result.group.rateMultiplier}x)`
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setGroupRunning(false)
    }
  }

  async function handleBulkUpdateGroup(): Promise<void> {
    const groupId = Number(group)
    if (!Number.isFinite(groupId) || groupId < 1) {
      setError('Select a valid group')
      return
    }

    const targets = filteredAccounts.filter(
      (account) => managedGroupSiteIds.has(account.siteId) && account.apiKey && account.apiKeyId
    )
    if (targets.length === 0) {
      setMessage('No supported API keys to update in the current filter.')
      return
    }
    if (!confirm(`Update group for ${targets.length} API key(s)?`)) return

    setBulkGroupRunning(true)
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
          const result = await window.electronAPI.updateApiKeyGroup({ accountId: account.id, groupId })
          success += 1
          setAccounts((prev) => prev.map((item) => (item.id === result.account.id ? result.account : item)))
        } catch (err) {
          failures.push(`${accountLabel}: ${String(err)}`)
        }
      }
      setMessage(`Updated group for ${success}/${targets.length} API key(s).`)
      if (failures.length > 0) setError(failures.slice(0, 3).join('\n'))
    } finally {
      setBulkGroupRunning(false)
      setBulkProgress('')
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

  async function handleGetBalance(accountId: string): Promise<void> {
    setBalanceRunningId(accountId)
    setError('')
    setMessage('')
    try {
      const result = await window.electronAPI.getApiKeyBalance({ accountId })
      setAccounts((prev) => prev.map((account) => (account.id === result.account.id ? result.account : account)))
      setMessage(`Fetched balance for ${result.account.username || result.account.email}: ${result.label}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setBalanceRunningId(null)
    }
  }

  async function handleBulkGetBalance(): Promise<void> {
    const selected = new Set(selectedAccountIds)
    const targets = filteredAccounts.filter(
      (account) => selected.has(account.id) && account.apiKey && balanceSupportedSiteIds.has(account.siteId)
    )

    if (targets.length === 0) {
      setMessage('No selected API keys support balance lookup.')
      return
    }

    setBulkBalanceRunning(true)
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
          const result = await window.electronAPI.getApiKeyBalance({ accountId: account.id })
          success += 1
          setAccounts((prev) => prev.map((item) => (item.id === result.account.id ? result.account : item)))
        } catch (err) {
          failures.push(`${accountLabel}: ${String(err)}`)
        }
      }

      setMessage(`Fetched balances for ${success}/${targets.length} account(s).`)
      if (failures.length > 0) setError(failures.slice(0, 3).join('\n'))
    } finally {
      setBulkBalanceRunning(false)
      setBulkProgress('')
    }
  }

  function toggleSelectedAccount(accountId: string, checked: boolean): void {
    setSelectedAccountIds((prev) => {
      if (checked) return prev.includes(accountId) ? prev : [...prev, accountId]
      return prev.filter((id) => id !== accountId)
    })
  }

  function handleExport(): void {
    setShowExportModal(true)
  }

  function doExport(): void {
    const minBal = exportMinBalance.trim() !== '' ? Number(exportMinBalance) : undefined
    const maxBal = exportMaxBalance.trim() !== '' ? Number(exportMaxBalance) : undefined

    const lines = filteredAccounts
      .filter((account) => {
        if (!account.apiKey) return false
        if (exportSkipNoBalance && account.apiBalance == null) return false
        if (minBal !== undefined && (account.apiBalance ?? 0) < minBal) return false
        if (maxBal !== undefined && (account.apiBalance ?? 0) > maxBal) return false
        return true
      })
      .map(
        (account) =>
          `${getSiteName(account.siteId)}|${account.username || account.email || account.id}|${account.apiKey}|${account.apiKeyGroupName || ''}|${account.apiBalance != null ? account.apiBalance.toFixed(4) : ''}|${account.apiUsedQuota != null ? account.apiUsedQuota.toFixed(4) : ''}`
      )

    if (lines.length === 0) {
      setError('No API keys match the export filters')
      setShowExportModal(false)
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
    setShowExportModal(false)
  }

  const selectedAccount = accounts.find((account) => account.id === accountId)
  const filteredAccounts = accounts.filter((account) => !siteFilter || account.siteId === siteFilter)
  const groupSelectOptions =
    selectedAccount?.siteId === 'weilai-chat'
      ? groupOptions.length > 0
        ? groupOptions
        : WEILAI_DEFAULT_GROUPS
      : groupOptions
  const selectedAccountSupportsManagedGroups = selectedAccount ? managedGroupSiteIds.has(selectedAccount.siteId) : false
  const selectedAccountSupportsBalance = selectedAccount ? balanceSupportedSiteIds.has(selectedAccount.siteId) : false
  const selectableBalanceAccounts = filteredAccounts.filter(
    (account) => account.apiKey && balanceSupportedSiteIds.has(account.siteId)
  )
  const selectedBalanceAccountCount = selectableBalanceAccounts.filter((account) => selectedAccountIds.includes(account.id)).length
  const allBalanceAccountsSelected =
    selectableBalanceAccounts.length > 0 && selectedBalanceAccountCount === selectableBalanceAccounts.length

  useEffect(() => {
    if (selectedAccount && managedGroupSiteIds.has(selectedAccount.siteId)) {
      setGroup((current) => {
        if (selectedAccount.apiKeyGroupId) return String(selectedAccount.apiKeyGroupId)
        if (current) return current
        return selectedAccount.siteId === 'weilai-chat' ? '22' : ''
      })
      void loadGroupOptions(selectedAccount.id)
    } else {
      setGroupOptions([])
    }
  }, [selectedAccount?.id, selectedAccount?.siteId, accounts])

  useEffect(() => {
    const visibleIds = new Set(filteredAccounts.map((account) => account.id))
    setSelectedAccountIds((current) => current.filter((id) => visibleIds.has(id)))
  }, [siteFilter, accounts])

  function getSiteName(siteId: string): string {
    return sites.find((site) => site.id === siteId)?.name ?? siteId
  }

  const totalKeys = accounts.filter((a) => a.apiKey).length
  const accountsWithBalance = accounts.filter((a) => a.apiBalance != null)
  const totalBalance = accountsWithBalance.reduce((sum, a) => sum + (a.apiBalance ?? 0), 0)
  const totalUsed = accounts.filter((a) => a.apiUsedQuota != null).reduce((sum, a) => sum + (a.apiUsedQuota ?? 0), 0)

  // Per-site breakdown
  const siteStats = sites.map((site) => {
    const siteAccounts = accounts.filter((a) => a.siteId === site.id)
    const siteKeys = siteAccounts.filter((a) => a.apiKey).length
    const siteBalance = siteAccounts.filter((a) => a.apiBalance != null).reduce((sum, a) => sum + (a.apiBalance ?? 0), 0)
    const siteBalanceFetched = siteAccounts.some((a) => a.apiBalance != null)
    return { site, total: siteAccounts.length, keys: siteKeys, balance: siteBalance, balanceFetched: siteBalanceFetched }
  }).filter((s) => s.total > 0)

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">API Keys</h1>
        <p className="page-subtitle">Create New API keys for registered site accounts and save them back to Accounts.</p>
      </header>

      {accounts.length > 0 && (
        <>
          <div className="stats">
            <div className="stat-card">
              <div className="stat-icon neutral">
                <KeyIcon size={20} />
              </div>
              <div>
                <div className="stat-value">{totalKeys}</div>
                <div className="stat-label">API Keys Created</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon success">
                <WalletIcon size={20} />
              </div>
              <div>
                <div className="stat-value">${totalBalance.toFixed(2)}</div>
                <div className="stat-label">Total Balance{accountsWithBalance.length > 0 ? ` (${accountsWithBalance.length} fetched)` : ''}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon danger">
                <TrendUpIcon size={20} />
              </div>
              <div>
                <div className="stat-value">${totalUsed.toFixed(2)}</div>
                <div className="stat-label">Total Used Quota</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon neutral">
                <ServerIcon size={20} />
              </div>
              <div>
                <div className="stat-value">{accounts.length}</div>
                <div className="stat-label">Total Accounts</div>
              </div>
            </div>
          </div>

          {siteStats.length > 1 && (
            <Card title="Per-Site Breakdown" icon={<TrendUpIcon size={18} />}>
              <div className="table-scroll" style={{ maxHeight: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Accounts</th>
                      <th>Keys Created</th>
                      <th>Coverage</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteStats.map(({ site, total, keys, balance, balanceFetched }) => (
                      <tr key={site.id}>
                        <td>{site.name}</td>
                        <td>{total}</td>
                        <td>{keys}</td>
                        <td>
                          <div className="stack">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                flex: 1,
                                height: 6,
                                borderRadius: 999,
                                background: 'var(--surface-3)',
                                overflow: 'hidden',
                                minWidth: 60
                              }}>
                                <div style={{
                                  height: '100%',
                                  width: `${total > 0 ? Math.round((keys / total) * 100) : 0}%`,
                                  background: 'var(--accent)',
                                  borderRadius: 999
                                }} />
                              </div>
                              <span className="cell-secondary">{total > 0 ? Math.round((keys / total) * 100) : 0}%</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {balanceFetched ? (
                            <span>${balance.toFixed(4)}</span>
                          ) : (
                            <span className="cell-secondary">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {accounts.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<ServerIcon size={26} />}
            title="No supported site accounts"
            description="Register a TokenLB, WeiLai, or AI-ROUTER account first, then create an API key from this tab."
          />
        </Card>
      ) : (
        <>
          <Card title="Create Key" icon={<ServerIcon size={18} />}>
            <div className="form-grid">
              <Field label="Site">
                <Select
                  value={siteFilter}
                  onChange={(e) => {
                    const nextSite = e.target.value
                    setSiteFilter(nextSite)
                    const nextAccounts = accounts.filter((account) => !nextSite || account.siteId === nextSite)
                    setAccountId(nextAccounts[0]?.id || '')
                  }}
                >
                  <option value="">All supported sites</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Account">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {filteredAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {getSiteName(account.siteId)} - {account.username || account.email} {account.apiKey ? '(has key)' : ''}
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
              <Field
                label="Group / Group ID"
                hint={
                  selectedAccount?.siteId === 'weilai-chat'
                    ? 'WeiLai updates existing keys with PUT /api/v1/keys/{id}; it does not create a new key.'
                    : selectedAccount?.siteId === 'ai-router'
                      ? 'AI-ROUTER creates new keys with POST /keys and updates groups with PUT /keys/{id}.'
                      : undefined
                }
              >
                {selectedAccountSupportsManagedGroups && groupSelectOptions.length > 0 ? (
                  <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                    {groupSelectOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} - {option.platform} - {option.rateMultiplier}x
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input value={group} placeholder="22" onChange={(e) => setGroup(e.target.value)} />
                )}
                {groupsLoading && <p className="input-hint">Loading groups...</p>}
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
                the site's login page and retry.
              </p>
            )}
            {error && <div className="field-error">{error}</div>}
            {message && <div className="field-success">{message}</div>}
            {bulkProgress && <div className="cell-secondary">Bulk progress: {bulkProgress}</div>}
            <div className="actions">
              <Button
                variant="primary"
                loading={running}
                disabled={bulkRunning || groupRunning || bulkGroupRunning || bulkBalanceRunning}
                icon={<PlayIcon size={16} />}
                onClick={() => void handleCreate()}
              >
                Create API Key
              </Button>
              <Button
                variant="secondary"
                loading={bulkRunning}
                disabled={running || groupRunning || bulkGroupRunning || bulkBalanceRunning}
                icon={<PlayIcon size={16} />}
                onClick={() => void handleCreateAll()}
              >
                Create For All
              </Button>
              <Button variant="ghost" icon={<RefreshIcon size={15} />} onClick={() => void load()}>
                Refresh
              </Button>
              <Button
                variant="secondary"
                loading={groupRunning}
                disabled={!selectedAccount?.apiKey || !selectedAccountSupportsManagedGroups || running || bulkRunning || bulkGroupRunning || bulkBalanceRunning}
                icon={<RefreshIcon size={15} />}
                onClick={() => void handleUpdateGroup()}
              >
                Update Group
              </Button>
              <Button
                variant="secondary"
                loading={bulkGroupRunning}
                disabled={
                  running ||
                  bulkRunning ||
                  groupRunning ||
                  bulkBalanceRunning ||
                  filteredAccounts.every((account) => !managedGroupSiteIds.has(account.siteId) || !account.apiKey)
                }
                icon={<RefreshIcon size={15} />}
                onClick={() => void handleBulkUpdateGroup()}
              >
                Bulk Update Group
              </Button>
              <Button
                variant="secondary"
                loading={bulkBalanceRunning}
                disabled={running || bulkRunning || groupRunning || bulkGroupRunning || selectedBalanceAccountCount === 0}
                icon={<RefreshIcon size={15} />}
                onClick={() => void handleBulkGetBalance()}
              >
                Get Balance Bulk ({selectedBalanceAccountCount})
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
                    <th>
                      <input
                        type="checkbox"
                        checked={allBalanceAccountsSelected}
                        disabled={selectableBalanceAccounts.length === 0 || bulkBalanceRunning}
                        onChange={(e) => {
                          const selectableIds = selectableBalanceAccounts.map((account) => account.id)
                          setSelectedAccountIds((current) => {
                            const currentSet = new Set(current)
                            if (e.target.checked) {
                              selectableIds.forEach((id) => currentSet.add(id))
                            } else {
                              selectableIds.forEach((id) => currentSet.delete(id))
                            }
                            return Array.from(currentSet)
                          })
                        }}
                        aria-label="Select all balance accounts"
                      />
                    </th>
                    <th>Site</th>
                    <th>Account</th>
                    <th>Email</th>
                    <th>API Key</th>
                    <th>Group</th>
                    <th>Balance</th>
                    <th>Name</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((account) => (
                    <tr key={account.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.includes(account.id)}
                          disabled={!account.apiKey || !balanceSupportedSiteIds.has(account.siteId) || bulkBalanceRunning}
                          onChange={(e) => toggleSelectedAccount(account.id, e.target.checked)}
                          aria-label={`Select ${account.username || account.email || account.id}`}
                        />
                      </td>
                      <td>{getSiteName(account.siteId)}</td>
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
                      <td>
                        <div className="stack">
                          <span>{account.apiKeyGroupName || '-'}</span>
                          {account.apiKeyGroupPlatform && (
                            <span className="cell-secondary">
                              {account.apiKeyGroupPlatform} · {account.apiKeyGroupRateMultiplier ?? 0}x
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          {account.apiBalance != null ? (
                            <>
                              <span>${account.apiBalance.toFixed(4)}</span>
                              {account.apiUsedQuota != null && (
                                <span className="cell-secondary">used ${account.apiUsedQuota.toFixed(4)}</span>
                              )}
                            </>
                          ) : (
                            <span>-</span>
                          )}
                          {account.apiBalanceFetchedAt && (
                            <span className="cell-secondary">{new Date(account.apiBalanceFetchedAt).toLocaleString()}</span>
                          )}
                        </div>
                      </td>
                      <td>{account.apiKeyName || '-'}</td>
                      <td className="cell-secondary">
                        {account.apiKeyCreatedAt ? new Date(account.apiKeyCreatedAt).toLocaleString() : '-'}
                      </td>
                      <td>
                        <div className="actions actions-inline">
                          <Button
                            variant="ghost"
                            loading={balanceRunningId === account.id}
                            disabled={!account.apiKey || !balanceSupportedSiteIds.has(account.siteId) || bulkBalanceRunning}
                            icon={<RefreshIcon size={15} />}
                            onClick={() => void handleGetBalance(account.id)}
                          >
                            Get Balance
                          </Button>
                          <Button
                            variant="ghost"
                            loading={groupRunning && accountId === account.id}
                            disabled={!account.apiKey || !managedGroupSiteIds.has(account.siteId) || groupRunning || bulkGroupRunning}
                            icon={<RefreshIcon size={15} />}
                            onClick={() => void handleUpdateGroup(account.id)}
                          >
                            Set Group
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {showExportModal && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
            <div className="modal-header">
              <h2 id="export-modal-title" className="modal-title">Export API Keys</h2>
              <p className="modal-subtitle">Filter which keys to include in the export.</p>
            </div>
            <div className="modal-body">
              <Field label="Min Balance ($)" hint="Only export keys with balance ≥ this value">
                <Input
                  type="number"
                  value={exportMinBalance}
                  placeholder="e.g. 0.5"
                  onChange={(e) => setExportMinBalance(e.target.value)}
                />
              </Field>
              <Field label="Max Balance ($)" hint="Only export keys with balance ≤ this value">
                <Input
                  type="number"
                  value={exportMaxBalance}
                  placeholder="e.g. 100"
                  onChange={(e) => setExportMaxBalance(e.target.value)}
                />
              </Field>
              <Field label="Balance Check">
                <Checkbox
                  label="Skip accounts with no balance data fetched"
                  checked={exportSkipNoBalance}
                  onChange={(e) => setExportSkipNoBalance(e.target.checked)}
                />
              </Field>
              <p className="cell-secondary">
                Format: site|username|apiKey|group|balance|usedQuota
              </p>
            </div>
            <div className="modal-actions">
              <Button variant="primary" icon={<DownloadIcon size={15} />} onClick={doExport}>
                Export
              </Button>
              <Button variant="ghost" onClick={() => setShowExportModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
