import { useEffect, useState } from 'react'
import type { RegistrationLogRecord } from '../../shared/contracts'
import { AlertTriangleIcon, Button, Card, EmptyState, RefreshIcon, TrashIcon } from '../components/ui'

export default function LogsTab(): JSX.Element {
  const [logs, setLogs] = useState<RegistrationLogRecord[]>([])

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    const items = await window.electronAPI.getRegistrationLogs()
    setLogs(items.reverse())
  }

  async function handleClear(): Promise<void> {
    if (!confirm('Clear all registration failure logs?')) return
    await window.electronAPI.clearRegistrationLogs()
    await load()
  }

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Logs</h1>
        <p className="page-subtitle">Registration failures are stored here instead of Accounts.</p>
      </header>

      <div className="toolbar">
        <div className="toolbar-spacer" />
        <div className="actions actions-inline">
          <Button variant="danger" icon={<TrashIcon size={15} />} disabled={logs.length === 0} onClick={() => void handleClear()}>
            Clear Logs
          </Button>
          <Button variant="ghost" icon={<RefreshIcon size={15} />} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {logs.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<AlertTriangleIcon size={26} />}
            title="No failure logs"
            description="Failed registration attempts will appear here."
          />
        </Card>
      ) : (
        <Card flush>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Site</th>
                  <th>Job</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="cell-secondary">{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.siteName}</td>
                    <td className="mono">{log.jobId}</td>
                    <td className="mono">{log.username || '-'}</td>
                    <td className="mono">{log.email || '-'}</td>
                    <td className="cell-secondary">{log.error}</td>
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
