# 04 — Proxy (HTTP & SOCKS5)

## Mục tiêu

Hỗ trợ proxy **HTTP/HTTPS** và **SOCKS5** (có/không auth), gán linh hoạt theo browser profile hoặc theo từng job.

## ProxyConfig (shared type)

```typescript
type ProxyType = 'http' | 'https' | 'socks5' | 'direct';

interface ProxyConfig {
  id: string;
  label: string;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Bypass rules cho Electron, e.g. "<local>" */
  bypass?: string;
}
```

## ProxyParser (`proxy/proxy-parser.ts`)

Parse nhiều format input từ UI hoặc import file:

| Format | Ví dụ |
|--------|-------|
| host:port | `103.152.112.162:80` |
| type://host:port | `socks5://127.0.0.1:1080` |
| auth URL | `http://user:pass@host:port` |
| socks5 auth | `socks5://user:pass@host:port` |

```typescript
function parseProxyLine(line: string): ProxyConfig | null;
function parseProxyList(text: string): ProxyConfig[];  // mỗi dòng 1 proxy
```

## ProxyManager (`proxy/proxy-manager.ts`)

```typescript
class ProxyManager {
  add(proxy: ProxyConfig): void;
  remove(id: string): void;
  list(): ProxyConfig[];
  get(id: string): ProxyConfig | undefined;

  /** Áp proxy cho Electron session (browser) */
  applyToSession(electronSession: Session, proxy: ProxyConfig): Promise<void>;

  /** Tạo fetch agent cho HTTP calls trong main process */
  createFetchDispatcher(proxy?: ProxyConfig): Dispatcher | undefined;

  /** Test proxy — GET tới https://api.ipify.org?format=json */
  test(proxy: ProxyConfig): Promise<{ ok: boolean; ip?: string; latencyMs: number; error?: string }>;

  /** Rotate: lấy proxy tiếp theo trong pool */
  next(strategy?: 'round-robin' | 'random'): ProxyConfig | undefined;
}
```

## Áp proxy cho Browser (Electron session)

Electron `session.setProxy()` hỗ trợ SOCKS5:

```typescript
await session.setProxy({
  proxyRules: buildProxyRules(proxy),
  proxyBypassRules: proxy.bypass ?? '<local>',
});

function buildProxyRules(p: ProxyConfig): string {
  if (p.type === 'direct') return 'direct://';
  const auth = p.username ? `${p.username}:${p.password}@` : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}
```

> **Lưu ý:** Electron proxy auth (user/pass) có thể cần `app.on('login')` handler để supply credentials khi proxy challenge.

```typescript
session.webRequest.onBeforeSendHeaders?.(...);  // không cần cho basic proxy auth nếu embed trong URL

// Global handler once in main:
app.on('login', (event, _wc, _details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const proxy = proxyManager.getByHost(authInfo.host);
    if (proxy?.username) {
      event.preventDefault();
      callback(proxy.username, proxy.password ?? '');
    }
  }
});
```

## Áp proxy cho HTTP fetch (main process)

Các API call không qua browser (Gmailnator, tokenlb `/api/user/register`) cũng đi qua proxy nếu job yêu cầu:

```typescript
import { ProxyAgent } from 'undici';           // HTTP proxy
import { SocksProxyAgent } from 'socks-proxy-agent';  // SOCKS5

function createAgent(proxy: ProxyConfig) {
  const url = formatProxyUrl(proxy);
  if (proxy.type === 'socks5') return new SocksProxyAgent(url);
  return new ProxyAgent(url);
}

// fetch with dispatcher
await fetch(url, { dispatcher: createAgent(proxy) });
```

Dependencies: `undici`, `socks-proxy-agent`.

## Gán proxy trong job

```typescript
interface JobProxyOptions {
  mode: 'none' | 'fixed' | 'rotate' | 'profile';  // profile = dùng proxy gắn sẵn trên BrowserProfile
  proxyId?: string;
  proxyIds?: string[];   // rotate pool
}
```

| mode | Browser traffic | API fetch (main) |
|------|-----------------|------------------|
| `none` | direct | direct |
| `fixed` | proxy X | proxy X |
| `rotate` | proxy[i % n] | cùng proxy job đó |
| `profile` | proxy của BrowserProfile | optional theo profile |

**Khuyến nghị:** Browser và API fetch của cùng 1 job nên dùng **cùng proxy** để IP nhất quán (Turnstile + verification).

## UI — Tab Proxies

- Textarea import bulk (1 proxy/dòng)
- Bảng: label, type, host:port, auth, nút Test / Delete
- Dropdown gán proxy khi tạo Browser Profile
- Checkbox "Use proxy for API calls" (default on khi proxy enabled)

## Lưu trữ

`electron-store` key `proxies: ProxyConfig[]` — **không** commit file chứa proxy thật vào git.

## Xử lý lỗi

| Lỗi | Xử lý |
|-----|-------|
| Proxy unreachable | `test()` fail trước job; log warning, skip hoặc retry proxy khác |
| SOCKS5 auth fail | Hiện lỗi rõ trong job log |
| Turnstile fail qua proxy | Retry với proxy khác hoặc show cloak window |
