# 08 — Implementation Roadmap

Triển khai theo phase — **core + abstractions trước**, site/email cụ thể sau.

## Phase 0 — Scaffold

- [ ] `electron-vite` + React + TypeScript
- [ ] `src/shared/contracts/` — tất cả interfaces
- [ ] `core/registry.ts`, `core/job-runner.ts` (skeleton)
- [ ] Preload + IPC wiring cơ bản
- [ ] `.gitignore`, scripts `dev` / `build` / `dist`

**Deliverable:** App mở được, IPC ping/pong.

## Phase 1 — Proxy & Browser foundation

- [ ] `proxy/proxy-parser.ts`, `proxy/proxy-manager.ts`
- [ ] HTTP + SOCKS5 test, `session.setProxy`, fetch dispatcher
- [ ] `browser/browser-profile.ts`, `browser/browser-pool.ts`
- [ ] `browser/cloak-session.ts` — Turnstile token helper
- [ ] UI tab Proxies + Browsers (CRUD, test, show window)

**Deliverable:** Tạo profile, gán proxy, mở cloak window load tokenlb.net/sign-up, lấy Turnstile token.

## Phase 2 — Email provider (Gmailnator)

- [ ] `email-providers/gmailnator/` full implementation
- [ ] Dynamic settings form từ `getConfigSchema()`
- [ ] Test connection button

**Deliverable:** Generate email + poll inbox từ UI test.

## Phase 3 — Site provider (tokenlb)

- [ ] `site-providers/tokenlb/` — full register flow
- [ ] Kết nối JobRunner end-to-end
- [ ] `storage/account-store.ts`

**Deliverable:** Đăng ký 1 tài khoản tokenlb thành công, lưu JSON.

## Phase 4 — UI hoàn chỉnh

- [ ] Tab Register với batch, progress log
- [ ] Tab Accounts + Export JSON
- [ ] Cancel job, error display
- [ ] `maxConcurrent` parallel jobs

**Deliverable:** Batch 5 accounts, export file.

## Phase 5 — Polish

- [ ] Proxy rotate + browser rotate trong batch
- [ ] Retry policy (proxy fail → next proxy)
- [ ] App icon, window title, vi-VN labels (UI text)
- [ ] `electron-builder` config

---

## Dependencies (`package.json`)

```json
{
  "dependencies": {
    "electron-store": "^8",
    "uuid": "^9",
    "socks-proxy-agent": "^8",
    "undici": "^6"
  },
  "devDependencies": {
    "electron": "^33",
    "electron-vite": "^2",
    "electron-builder": "^24",
    "typescript": "^5",
    "react": "^18",
    "react-dom": "^18",
    "@types/react": "^18",
    "@vitejs/plugin-react": "^4"
  }
}
```

## Thứ tự ưu tiên khi conflict

1. Contracts/interfaces đúng trước — tránh refactor sau
2. Proxy + Browser pool trước site provider — tokenlb cần cả hai
3. MVP tokenlb chạy end-to-end trước khi thêm site thứ 2

## Thêm site thứ 2 (sau MVP)

1. Copy pattern `site-providers/tokenlb/`
2. Implement `SiteProvider`
3. `registry.registerSite(newProvider)`
4. Zero changes to `JobRunner`, `BrowserPool`, `ProxyManager`

## Rủi ro

| Rủi ro | Mitigation |
|--------|------------|
| Turnstile block proxy IP | Rotate proxy; show cloak window |
| Gmailnator rate limit | interJobDelayMs; private email types |
| Electron SOCKS5 auth | `app.on('login')` handler |
| Parallel cookie leak | 1 job = 1 browser profile, never share |
