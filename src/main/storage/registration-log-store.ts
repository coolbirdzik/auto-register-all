import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { RegistrationLogRecord } from '../../shared/contracts'

export class RegistrationLogStore {
  private filePath: string
  private mutex = Promise.resolve()

  constructor() {
    this.filePath = join(app.getPath('userData'), 'registration-logs.json')
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn)
    this.mutex = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async readAll(): Promise<RegistrationLogRecord[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data) as RegistrationLogRecord[]
    } catch {
      return []
    }
  }

  private async writeAll(logs: RegistrationLogRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(logs, null, 2), 'utf-8')
  }

  async append(record: RegistrationLogRecord): Promise<void> {
    await this.withLock(async () => {
      const logs = await this.readAll()
      logs.push(record)
      await this.writeAll(logs)
    })
  }

  async list(): Promise<RegistrationLogRecord[]> {
    return this.readAll()
  }

  async clear(): Promise<void> {
    await this.withLock(async () => {
      await this.writeAll([])
    })
  }
}
