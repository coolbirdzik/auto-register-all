import { type ChangeEvent, useEffect, useState } from 'react'
import type { FreeProxySettings, FreeProxySource, ProxyConfig, ZingProxySettings } from '../../shared/contracts'
import {
  Badge,
  Button,
  Card,
  DownloadIcon,
  EmptyState,
  Field,
  GlobeIcon,
  Input,
  PlusIcon,
  RefreshIcon,
  Select,
  Textarea,
  TrashIcon
} from '../components/ui'

interface TestResult {
  ok: boolean
  text: string
}

export default function ProxiesTab(): JSX.Element {
  const [proxies, setProxies] = useState<ProxyConfig[]>([])
  const [importText, setImportText] = useState('')
  const [zingProxy, setZingProxy] = useState<ZingProxySettings>({})
  const [freeProxy, setFreeProxy] = useState<FreeProxySettings>({ source: 'proxyscrape', country: 'vn' })
  const [importResult, setImportResult] = useState<TestResult | null>(null)
  const [importingZingProxy, setImportingZingProxy] = useState(false)
  const [importingFreeProxy, setImportingFreeProxy] = useState(false)
  const [zingProxyResult, setZingProxyResult] = useState<TestResult | null>(null)
  const [freeProxyResult, setFreeProxyResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [testedCount, setTestedCount] = useState(0)
  const [maintenanceResult, setMaintenanceResult] = useState<TestResult | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const [proxyList, settings] = await Promise.all([
      window.electronAPI.listProxies(),
      window.electronAPI.getSettings()
    ])
    setProxies(proxyList)
    setZingProxy(settings.proxyProviders?.zingproxy ?? {})
    setFreeProxy(settings.proxyProviders?.freeProxy ?? { source: 'proxyscrape', country: 'vn' })
  }

  async function handleImport(): Promise<void> {
    if (!importText.trim()) return
    await importProxyContent(importText)
    setImportText('')
  }

  async function importProxyContent(content: string): Promise<number> {
    const imported = await window.electronAPI.importProxies(content)
    if (imported.length > 0) {
      setProxies(await window.electronAPI.listProxies())
    }
    setImportResult({
      ok: imported.length > 0,
      text: imported.length > 0 ? `Imported ${imported.length}` : 'No new proxies found'
    })
    return imported.length
  }

  async function handleFileImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    try {
      let total = 0
      for (const file of files) {
        total += await importProxyContent(await file.text())
      }
      setImportResult({
        ok: total > 0,
        text: total > 0 ? `Imported ${total} from file` : 'No new proxies found in file'
      })
    } catch (err) {
      setImportResult({ ok: false, text: String(err) })
    }
  }

  async function testProxy(id: string): Promise<TestResult> {
    try {
      const result = await window.electronAPI.testProxy(id)
      return {
        ok: result.ok,
        text: result.ok ? `${result.ip} · ${result.latencyMs}ms` : `Fail: ${result.error}`
      }
    } catch (err) {
      return { ok: false, text: `Error: ${String(err)}` }
    }
  }

  async function handleTest(id: string): Promise<void> {
    setTesting(id)
    try {
      const result = await testProxy(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } finally {
      setTesting(null)
    }
  }

  async function handleTestAll(): Promise<void> {
    if (proxies.length === 0) return

    const concurrency = 8
    const queue = [...proxies]
    let okCount = 0
    let failCount = 0

    setTestingAll(true)
    setTestedCount(0)
    setMaintenanceResult(null)

    async function worker(): Promise<void> {
      while (queue.length > 0) {
        const proxy = queue.shift()
        if (!proxy) return

        const result = await testProxy(proxy.id)
        if (result.ok) okCount += 1
        else failCount += 1

        setTestResults((prev) => ({ ...prev, [proxy.id]: result }))
        setTestedCount((count) => count + 1)
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, proxies.length) }, () => worker()))
      setMaintenanceResult({
        ok: failCount === 0,
        text: `Tested ${proxies.length}: ${okCount} ok, ${failCount} failed`
      })
    } finally {
      setTestingAll(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await window.electronAPI.removeProxy(id)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    void load()
  }

  async function handleDeleteFailed(): Promise<void> {
    const failedIds = proxies
      .filter((proxy) => testResults[proxy.id] && !testResults[proxy.id].ok)
      .map((proxy) => proxy.id)

    if (failedIds.length === 0) return

    await Promise.all(failedIds.map((id) => window.electronAPI.removeProxy(id)))
    setTestResults((prev) => {
      const next = { ...prev }
      failedIds.forEach((id) => delete next[id])
      return next
    })
    setMaintenanceResult({ ok: true, text: `Deleted ${failedIds.length} failed proxy(ies)` })
    setProxies(await window.electronAPI.listProxies())
  }

  async function handleZingProxyImport(): Promise<void> {
    setImportingZingProxy(true)
    setZingProxyResult(null)
    try {
      const result = await window.electronAPI.importZingProxyProxies(zingProxy)
      setProxies(await window.electronAPI.listProxies())
      setZingProxyResult({
        ok: true,
        text: `Imported ${result.imported.length}, skipped ${result.skipped}`
      })
    } catch (err) {
      setZingProxyResult({ ok: false, text: String(err) })
    } finally {
      setImportingZingProxy(false)
    }
  }

  async function handleFreeProxyImport(): Promise<void> {
    setImportingFreeProxy(true)
    setFreeProxyResult(null)
    try {
      const result = await window.electronAPI.importFreeProxies(freeProxy)
      setProxies(await window.electronAPI.listProxies())
      setFreeProxyResult({
        ok: true,
        text: `Imported ${result.imported.length}, skipped ${result.skipped}`
      })
    } catch (err) {
      setFreeProxyResult({ ok: false, text: String(err) })
    } finally {
      setImportingFreeProxy(false)
    }
  }

  function updateZingProxy(key: keyof ZingProxySettings, value: string): void {
    setZingProxy((prev) => ({ ...prev, [key]: value }))
  }

  function updateFreeProxy(key: keyof FreeProxySettings, value: string): void {
    setFreeProxy((prev) => ({ ...prev, [key]: value }))
  }

  const failedProxyCount = proxies.filter((proxy) => testResults[proxy.id] && !testResults[proxy.id].ok).length

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Proxies</h1>
        <p className="page-subtitle">Import and verify proxies used for registration traffic.</p>
      </header>

      <Card
        title="Import Proxies"
        icon={<DownloadIcon size={18} />}
        subtitle="Paste TXT lines or JSON proxy arrays, then import them into the local proxy pool."
      >
        <Textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'103.152.112.162:80\nhttp://user:pass@127.0.0.1:8080\n[{"type":"http","host":"127.0.0.1","port":8080}]'}
        />
        <Field label="Import File" hint="Supports .txt and .json files. JSON may be an array or an object with a proxies array.">
          <Input
            type="file"
            accept=".txt,.json,text/plain,application/json"
            multiple
            onChange={(e) => void handleFileImport(e)}
          />
        </Field>
        <div className="actions">
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => void handleImport()}>
            Import
          </Button>
          {importResult && (
            <Badge tone={importResult.ok ? 'success' : 'danger'} dot>
              {importResult.text}
            </Badge>
          )}
        </div>
      </Card>

      <Card
        title="Import Free Proxies"
        icon={<GlobeIcon size={18} />}
        subtitle="Fetch public proxies and add only new browser-supported endpoints."
      >
        <div className="form-grid">
          <Field label="Source">
            <Select
              value={freeProxy.source ?? 'proxyscrape'}
              onChange={(e) => updateFreeProxy('source', e.target.value as FreeProxySource)}
            >
              <option value="proxyscrape">ProxyScrape</option>
              <option value="speedx-http">TheSpeedX HTTP</option>
              <option value="monosans-http">monosans HTTP</option>
            </Select>
          </Field>
          {(freeProxy.source ?? 'proxyscrape') === 'proxyscrape' && (
            <Field label="ProxyScrape Country" hint="Use a two-letter country code such as vn, us, sg, or jp.">
              <Input
                value={freeProxy.country ?? 'vn'}
                maxLength={2}
                onChange={(e) => updateFreeProxy('country', e.target.value)}
              />
            </Field>
          )}
        </div>
        <div className="actions">
          <Button
            variant="primary"
            icon={<DownloadIcon size={16} />}
            loading={importingFreeProxy}
            onClick={() => void handleFreeProxyImport()}
          >
            Import Free Proxies
          </Button>
          {freeProxyResult && (
            <Badge tone={freeProxyResult.ok ? 'success' : 'danger'} dot>
              {freeProxyResult.text}
            </Badge>
          )}
        </div>
      </Card>

      <Card
        title="Import from ZingProxy"
        icon={<GlobeIcon size={18} />}
        subtitle="Enter ZingProxy credentials to fetch an access token and import available proxy endpoints."
      >
        <div className="form-grid">
          <Field label="Access Token">
            <Input
              type="password"
              value={zingProxy.accessToken ?? ''}
              onChange={(e) => updateZingProxy('accessToken', e.target.value)}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={zingProxy.email ?? ''}
              onChange={(e) => updateZingProxy('email', e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={zingProxy.password ?? ''}
              onChange={(e) => updateZingProxy('password', e.target.value)}
            />
          </Field>
        </div>
        <div className="actions">
          <Button
            variant="primary"
            icon={<DownloadIcon size={16} />}
            loading={importingZingProxy}
            onClick={() => void handleZingProxyImport()}
          >
            Import from ZingProxy
          </Button>
          {zingProxyResult && (
            <Badge tone={zingProxyResult.ok ? 'success' : 'danger'} dot>
              {zingProxyResult.text}
            </Badge>
          )}
        </div>
      </Card>

      {proxies.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<GlobeIcon size={26} />}
            title="No proxies configured"
            description="Import proxies above to route registration sessions through them."
          />
        </Card>
      ) : (
        <Card flush>
          <div className="actions">
            <Button
              variant="secondary"
              icon={<RefreshIcon size={16} />}
              loading={testingAll}
              onClick={() => void handleTestAll()}
            >
              {testingAll ? `Testing ${testedCount}/${proxies.length}` : 'Test All'}
            </Button>
            <Button
              variant="danger"
              icon={<TrashIcon size={16} />}
              disabled={testingAll || failedProxyCount === 0}
              onClick={() => void handleDeleteFailed()}
            >
              Delete Failed
            </Button>
            {maintenanceResult && (
              <Badge tone={maintenanceResult.ok ? 'success' : 'danger'} dot>
                {maintenanceResult.text}
              </Badge>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Host:Port</th>
                  <th>Auth</th>
                  <th>Test</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>
                      <Badge tone="accent">{p.type}</Badge>
                    </td>
                    <td className="mono">
                      {p.host}:{p.port}
                    </td>
                    <td>
                      <Badge tone={p.username ? 'info' : 'neutral'}>{p.username ? 'Yes' : 'No'}</Badge>
                    </td>
                    <td>
                      <div className="stack">
                        <div>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={testing === p.id || testingAll}
                            onClick={() => void handleTest(p.id)}
                          >
                            {testing === p.id || testingAll ? 'Testing...' : 'Test'}
                          </Button>
                        </div>
                        {testResults[p.id] && (
                          <div className="test-result">
                            <Badge tone={testResults[p.id].ok ? 'success' : 'danger'} dot>
                              {testResults[p.id].text}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="cell-actions">
                        <button
                          className="icon-btn danger"
                          title="Delete proxy"
                          onClick={() => void handleDelete(p.id)}
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
