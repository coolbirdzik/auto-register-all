# 07 — Storage, UI & IPC

## Storage

### Settings (`electron-store`)

```typescript
interface AppSettings {
  emailProviders: Record<string, Record<string, unknown>>;  // { gmailnator: { apiKey, emailType } }
  siteConfigs: Record<string, Record<string, unknown>>;      // { tokenlb: { baseUrl, usernamePrefix } }
  browsers: BrowserProfile[];
  proxies: ProxyConfig[];
  defaults: {
    siteId: string;
    emailProviderId: string;
    browserMode: JobBrowserOptions['mode'];
    proxyMode: JobProxyOptions['mode'];
    maxConcurrent: number;
    interJobDelayMs: number;
  };
}
```

### Accounts (`userData/accounts.json`)

Append-only array, thread-safe write (mutex trong main process).

```typescript
interface AccountRecord {
  id: string;
  siteId: string;
  siteName: string;
  username: string;
  password: string;
  email: string;
  registeredAt: string;       // ISO 8601
  status: 'success' | 'failed';
  browserProfileId?: string;
  proxyId?: string;
  error?: string;
}
```

### Export

- **Export JSON** — `dialog.showSaveDialog`, filter `*.json`
- Options: all / success only / filter by siteId
- **Copy row** / **Copy all** (TSV hoặc JSON lines) — clipboard

## IPC API (`preload/index.ts`)

```typescript
interface ElectronAPI {
  // Settings
  getSettings(): Promise<AppSettings>;
  saveSettings(partial: Partial<AppSettings>): Promise<void>;

  // Registry metadata (for UI dropdowns)
  listSites(): Promise<SiteMeta[]>;
  listEmailProviders(): Promise<EmailMeta[]>;

  // Proxies
  listProxies(): Promise<ProxyConfig[]>;
  addProxy(proxy: ProxyConfig): Promise<void>;
  importProxies(text: string): Promise<ProxyConfig[]>;
  testProxy(proxyId: string): Promise<ProxyTestResult>;
  removeProxy(proxyId: string): Promise<void>;

  // Browsers
  listBrowserProfiles(): Promise<BrowserProfile[]>;
  createBrowserProfile(config: Partial<BrowserProfile>): Promise<BrowserProfile>;
  deleteBrowserProfile(id: string): Promise<void>;
  showBrowserProfile(id: string): Promise<void>;

  // Jobs
  startJob(options: StartJobOptions): Promise<{ jobId: string }>;
  cancelJob(jobId: string): Promise<void>;
  onJobProgress(callback: (event: JobProgressEvent) => void): () => void;

  // Accounts
  getAccounts(filter?: AccountFilter): Promise<AccountRecord[]>;
  exportAccounts(options: ExportOptions): Promise<{ canceled: boolean; path?: string }>;
  deleteAccount(id: string): Promise<void>;
}
```

### Job progress events

```typescript
type JobProgressEvent =
  | { type: 'job_started'; jobId: string; index: number; total: number }
  | { type: 'log'; jobId: string; level: LogLevel; message: string }
  | { type: 'job_completed'; jobId: string; result: RegisterResult }
  | { type: 'batch_completed'; successCount: number; failCount: number };
```

## UI Layout

```
┌──────────────────────────────────────────────────┐
│  Auto Register                            _ □ X  │
├──────────┬───────────────────────────────────────┤
│ Register │  [Site ▼ tokenlb]  [Email ▼ gmailnator]│
│ Accounts │  [Browser ▼ auto]  [Proxy ▼ rotate]   │
│ Proxies  │  Count: [1]  Delay: [3000ms]            │
│ Browsers │  [▶ Register]  [■ Cancel]               │
│ Settings │  ─────────────────────────────────────  │
│          │  Progress log (scrollable)              │
│          │  ✅ job 1/5 success user_abc...         │
└──────────┴───────────────────────────────────────┘
```

### Tab: Register

- Site + Email provider dropdowns (from registry)
- Browser mode + Proxy mode
- Batch count, inter-job delay
- Live log panel

### Tab: Accounts

- Filter by site, status
- Table columns: site, username, password, email, time, status
- Export / Delete selected

### Tab: Proxies

- Import textarea, table, test button
- See [04-proxy.md](./04-proxy.md)

### Tab: Browsers

- Profile list, assign proxy, show window, delete
- See [03-browser-engine.md](./03-browser-engine.md)

### Tab: Settings

- Dynamic config forms per email provider + per site (from `getConfigSchema()`)
- Default job options (`maxConcurrent`, delays)

## Security notes

- API keys chỉ ở main process + electron-store
- Preload expose typed API, không expose `nodeIntegration`
- `contextIsolation: true`, `sandbox: true` cho renderer
- Password hiển thị masked, toggle reveal per row
