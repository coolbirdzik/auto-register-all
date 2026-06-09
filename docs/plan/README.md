# Auto Register - Plan Index

App Electron đăng ký tài khoản tự động, thiết kế **plugin-based** để mở rộng nhiều trang, nhiều email provider, nhiều browser profile, và proxy HTTP/SOCKS5.

## Tài liệu plan

| File | Nội dung |
|------|----------|
| [01-overview.md](./01-overview.md) | Mục tiêu, phạm vi MVP, tech stack |
| [02-architecture.md](./02-architecture.md) | Kiến trúc plugin, interfaces, luồng job |
| [03-browser-engine.md](./03-browser-engine.md) | Browser pool, cloak browser, multi-profile |
| [04-proxy.md](./04-proxy.md) | HTTP/SOCKS5 proxy, gán proxy theo session |
| [05-email-providers.md](./05-email-providers.md) | Email provider abstraction, Gmailnator |
| [06-site-providers.md](./06-site-providers.md) | Site provider abstraction, tokenlb (New API) |
| [07-storage-ui-ipc.md](./07-storage-ui-ipc.md) | Lưu JSON, export, UI, IPC |
| [08-implementation-roadmap.md](./08-implementation-roadmap.md) | Thứ tự triển khai theo phase |

## Nguyên tắc thiết kế

1. **Core mỏng, plugin dày** — logic đặc thù từng trang nằm trong `site-providers/`, không sửa core khi thêm trang mới.
2. **Browser = tài nguyên có proxy riêng** — mỗi profile browser gắn 1 proxy (hoặc direct), rotate được.
3. **Contract rõ ràng** — mọi provider implement interface TypeScript, đăng ký qua registry.
4. **MVP trước** — tokenlb + Gmailnator + 1 browser; kiến trúc sẵn sàng scale ngay từ đầu.

## Site đầu tiên

- **tokenlb.net** — New API, email verification + Cloudflare Turnstile
- Chi tiết: [06-site-providers.md](./06-site-providers.md)
