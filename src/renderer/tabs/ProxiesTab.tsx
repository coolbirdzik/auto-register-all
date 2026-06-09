import { useEffect, useState } from 'react'
import type { ProxyConfig, ZingProxySettings } from '../../shared/contracts'
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
  const [importingZingProxy, setImportingZingProxy] = useState(false)
  const [zingProxyResult, setZingProxyResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
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
  }

  async function handleImport(): Promise<void> {
    if (!importText.trim()) return
    const imported = await window.electronAPI.importProxies(importText)
    setImportText('')
    setProxies(imported.length > 0 ? await window.electronAPI.listProxies() : proxies)
    if (imported.length > 0) alert(`Imported ${imported.length} proxy(ies)`)
  }

  async function handleTest(id: string): Promise<void> {
    setTesting(id)
    try {
      const result = await window.electronAPI.testProxy(id)
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: result.ok,
          text: result.ok ? `${result.ip} · ${result.latencyMs}ms` : `Fail: ${result.error}`
        }
      }))
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, text: `Error: ${String(err)}` } }))
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await window.electronAPI.removeProxy(id)
    void load()
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

  function updateZingProxy(key: keyof ZingProxySettings, value: string): void {
    setZingProxy((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Proxies</h1>
        <p className="page-subtitle">Import and verify proxies used for registration traffic.</p>
      </header>

      <Card
        title="Import Proxies"
        icon={<DownloadIcon size={18} />}
        subtitle="One HTTP proxy per line — host:port or http://user:pass@host:port"
      >
        <Textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'103.152.112.162:80\nhttp://user:pass@127.0.0.1:8080'}
        />
        <div className="actions">
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => void handleImport()}>
            Import
          </Button>
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
                            loading={testing === p.id}
                            onClick={() => void handleTest(p.id)}
                          >
                            {testing === p.id ? 'Testing...' : 'Test'}
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
