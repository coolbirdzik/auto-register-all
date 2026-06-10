import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountFilter,
  AccountRecord,
  AddAccountInput,
  AppSettings,
  BrowserProfile,
  CreateNewApiKeyOptions,
  CreateNewApiKeyResult,
  ExportOptions,
  FreeProxySettings,
  GetApiKeyBalanceOptions,
  GetApiKeyBalanceResult,
  AppUpdateInfo,
  AppUpdateState,
  ApiKeyGroupOption,
  ListApiKeyGroupsOptions,
  JobProgressEvent,
  ManualOtpRequest,
  ProxyConfig,
  ProxyTestResult,
  RegistrationLogRecord,
  ZingProxyImportResult,
  ZingProxySettings,
  SiteMeta,
  EmailMeta,
  StartJobOptions,
  UpdateApiKeyGroupOptions,
  UpdateApiKeyGroupResult
} from '../shared/contracts'

export interface ElectronAPI {
  getSettings(): Promise<AppSettings>
  saveSettings(partial: Partial<AppSettings>): Promise<void>
  listSites(): Promise<SiteMeta[]>
  listEmailProviders(): Promise<EmailMeta[]>
  listProxies(): Promise<ProxyConfig[]>
  addProxy(proxy: ProxyConfig): Promise<void>
  importProxies(text: string): Promise<ProxyConfig[]>
  importZingProxyProxies(config: ZingProxySettings): Promise<ZingProxyImportResult>
  importFreeProxies(config: FreeProxySettings): Promise<ZingProxyImportResult>
  testProxy(proxyId: string): Promise<ProxyTestResult>
  removeProxy(proxyId: string): Promise<void>
  listBrowserProfiles(): Promise<BrowserProfile[]>
  createBrowserProfile(config: Partial<BrowserProfile>): Promise<BrowserProfile>
  deleteBrowserProfile(id: string): Promise<void>
  showBrowserProfile(id: string): Promise<void>
  startJob(options: StartJobOptions): Promise<{ batchId: string }>
  cancelJob(): Promise<void>
  onJobProgress(callback: (event: JobProgressEvent) => void): () => void
  onManualOtpRequest(callback: (request: ManualOtpRequest) => void): () => void
  submitManualOtp(requestId: string, code: string): Promise<void>
  getAccounts(filter?: AccountFilter): Promise<AccountRecord[]>
  exportAccounts(options: ExportOptions): Promise<{ canceled: boolean; path?: string }>
  deleteAccount(id: string): Promise<void>
  deleteAccounts(ids: string[]): Promise<void>
  addAccount(input: AddAccountInput): Promise<AccountRecord>
  getRegistrationLogs(): Promise<RegistrationLogRecord[]>
  clearRegistrationLogs(): Promise<void>
  createNewApiKey(options: CreateNewApiKeyOptions): Promise<CreateNewApiKeyResult>
  getApiKeyBalance(options: GetApiKeyBalanceOptions): Promise<GetApiKeyBalanceResult>
  getAppVersion(): Promise<string>
  checkForUpdate(): Promise<AppUpdateInfo>
  getUpdateState(): Promise<AppUpdateState>
  checkForUpdateLive(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  quitAndInstallUpdate(): Promise<void>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
  openExternalUrl(url: string): Promise<void>
  listApiKeyGroups(options: ListApiKeyGroupsOptions): Promise<ApiKeyGroupOption[]>
  updateApiKeyGroup(options: UpdateApiKeyGroupOptions): Promise<UpdateApiKeyGroupResult>
  testEmailProvider(providerId: string): Promise<{ success: boolean; email?: string; error?: string }>
}

const api: ElectronAPI = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  listSites: () => ipcRenderer.invoke('list-sites'),
  listEmailProviders: () => ipcRenderer.invoke('list-email-providers'),
  listProxies: () => ipcRenderer.invoke('list-proxies'),
  addProxy: (proxy) => ipcRenderer.invoke('add-proxy', proxy),
  importProxies: (text) => ipcRenderer.invoke('import-proxies', text),
  importZingProxyProxies: (config) => ipcRenderer.invoke('import-zingproxy-proxies', config),
  importFreeProxies: (config) => ipcRenderer.invoke('import-free-proxies', config),
  testProxy: (proxyId) => ipcRenderer.invoke('test-proxy', proxyId),
  removeProxy: (proxyId) => ipcRenderer.invoke('remove-proxy', proxyId),
  listBrowserProfiles: () => ipcRenderer.invoke('list-browser-profiles'),
  createBrowserProfile: (config) => ipcRenderer.invoke('create-browser-profile', config),
  deleteBrowserProfile: (id) => ipcRenderer.invoke('delete-browser-profile', id),
  showBrowserProfile: (id) => ipcRenderer.invoke('show-browser-profile', id),
  startJob: (options) => ipcRenderer.invoke('start-job', options),
  cancelJob: () => ipcRenderer.invoke('cancel-job'),
  onJobProgress: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, event: JobProgressEvent): void => callback(event)
    ipcRenderer.on('job-progress', handler)
    return () => ipcRenderer.removeListener('job-progress', handler)
  },
  onManualOtpRequest: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, request: ManualOtpRequest): void => callback(request)
    ipcRenderer.on('manual-otp-request', handler)
    return () => ipcRenderer.removeListener('manual-otp-request', handler)
  },
  submitManualOtp: (requestId, code) => ipcRenderer.invoke('submit-manual-otp', requestId, code),
  getAccounts: (filter) => ipcRenderer.invoke('get-accounts', filter),
  exportAccounts: (options) => ipcRenderer.invoke('export-accounts', options),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  deleteAccounts: (ids) => ipcRenderer.invoke('delete-accounts', ids),
  addAccount: (input) => ipcRenderer.invoke('add-account', input),
  getRegistrationLogs: () => ipcRenderer.invoke('get-registration-logs'),
  clearRegistrationLogs: () => ipcRenderer.invoke('clear-registration-logs'),
  createNewApiKey: (options) => ipcRenderer.invoke('create-new-api-key', options),
  getApiKeyBalance: (options) => ipcRenderer.invoke('get-api-key-balance', options),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  getUpdateState: () => ipcRenderer.invoke('updater-get-state'),
  checkForUpdateLive: () => ipcRenderer.invoke('updater-check'),
  downloadUpdate: () => ipcRenderer.invoke('updater-download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('updater-quit-and-install'),
  onUpdateState: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, state: AppUpdateState): void => callback(state)
    ipcRenderer.on('update-state', handler)
    return () => ipcRenderer.removeListener('update-state', handler)
  },
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  listApiKeyGroups: (options) => ipcRenderer.invoke('list-api-key-groups', options),
  updateApiKeyGroup: (options) => ipcRenderer.invoke('update-api-key-group', options),
  testEmailProvider: (providerId) => ipcRenderer.invoke('test-email-provider', providerId)
}

contextBridge.exposeInMainWorld('electronAPI', api)
