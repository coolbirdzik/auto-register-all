import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { AccountFilter, AccountRecord } from '../../shared/contracts'

export class AccountStore {
  private filePath: string
  private mutex = Promise.resolve()

  constructor() {
    this.filePath = join(app.getPath('userData'), 'accounts.json')
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn, fn)
    this.mutex = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async readAll(): Promise<AccountRecord[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8')
      return JSON.parse(data) as AccountRecord[]
    } catch {
      return []
    }
  }

  private async writeAll(accounts: AccountRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(accounts, null, 2), 'utf-8')
  }

  async append(record: AccountRecord): Promise<void> {
    await this.withLock(async () => {
      const accounts = await this.readAll()
      accounts.push(record)
      await this.writeAll(accounts)
    })
  }

  async list(filter?: AccountFilter): Promise<AccountRecord[]> {
    const accounts = await this.readAll()
    return accounts.filter((a) => {
      if (filter?.siteId && a.siteId !== filter.siteId) return false
      if (filter?.status && a.status !== filter.status) return false
      return true
    })
  }

  async delete(id: string): Promise<void> {
    await this.withLock(async () => {
      const accounts = await this.readAll()
      await this.writeAll(accounts.filter((a) => a.id !== id))
    })
  }

  async deleteMany(ids: string[]): Promise<void> {
    const idSet = new Set(ids)
    await this.withLock(async () => {
      const accounts = await this.readAll()
      await this.writeAll(accounts.filter((a) => !idSet.has(a.id)))
    })
  }

  async exportFiltered(filter?: AccountFilter, successOnly?: boolean): Promise<AccountRecord[]> {
    let accounts = await this.list(filter)
    if (successOnly) {
      accounts = accounts.filter((a) => a.status === 'success')
    }
    return accounts
  }
}
