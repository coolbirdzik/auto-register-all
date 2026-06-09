# 05 — Email Providers

## Abstraction

Mọi nguồn email tạm implement `EmailProvider` (xem [02-architecture.md](./02-architecture.md)).

Site provider **không** gọi Gmailnator trực tiếp — lấy `EmailProvider` từ registry qua `JobContext`.

```typescript
// Trong SiteProvider.register():
const emailProvider = ctx.settings.emailProviderId; // resolved by JobRunner
const inbox = await emailRegistry.get(emailProvider).createInbox(ctx);
```

## Gmailnator Provider (MVP)

**ID:** `gmailnator`  
**Docs:** [Emailnator API v2](https://github.com/johndevzz/Emailnator-API-Docs)

### Config schema

```typescript
getConfigSchema(): ConfigField[] => [
  { key: 'apiKey', label: 'RapidAPI Key', type: 'secret', required: true },
  { key: 'emailType', label: 'Email Type', type: 'select', options: [
    'public_gmail_plus', 'private_gmail_plus', 'public_gmail_dot', ...
  ], default: 'private_gmail_plus' },
]
```

API key nhập trong Settings UI — **không hardcode** vào source. Key test user cung cấp chỉ dùng lúc dev thủ công.

### API endpoints

| Action | Method | Path |
|--------|--------|------|
| Generate | POST | `https://gmailnator.p.rapidapi.com/api/emails/generate` |
| Inbox list | POST | `.../api/inbox/` body `{ email, limit }` |
| Read message | GET | `.../api/inbox/{messageID}` |

Headers: `X-RapidAPI-Key`, `Content-Type: application/json`

### Implementation

```
src/main/email-providers/gmailnator/
├── index.ts           # export GmailnatorProvider
├── client.ts          # HTTP wrapper (respects proxy via ctx)
├── parser.ts          # extractVerificationCode
└── types.ts
```

```typescript
class GmailnatorProvider implements EmailProvider {
  readonly id = 'gmailnator';
  readonly name = 'Gmailnator (RapidAPI)';

  async createInbox(ctx: JobContext): Promise<Inbox> {
    const email = await this.client.generate(ctx);
    return { id: email, address: email, providerId: this.id, createdAt: new Date().toISOString() };
  }

  async waitForMessage(inbox, filter, timeoutMs): Promise<EmailMessage> {
    // poll POST /inbox/ every 5s
    // filter: { subjectIncludes?, fromIncludes? }
  }

  extractCode(message, pattern = /\b\d{6}\b/): string | null {
    const text = `${message.subject} ${message.text ?? ''} ${stripHtml(message.html ?? '')}`;
    return text.match(pattern)?.[0] ?? null;
  }
}
```

### HTTP qua proxy

`client.ts` nhận `dispatcher` từ `ProxyManager.createFetchDispatcher(ctx.proxy)` — đồng bộ IP với browser session.

## Inbox & Message types

```typescript
interface Inbox {
  id: string;
  address: string;
  providerId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  html?: string;
  text?: string;
}

interface MessageFilter {
  subjectIncludes?: string;
  fromIncludes?: string;
  since?: string;
}
```

## Thêm email provider mới (ví dụ tương lai)

| Provider | Ghi chú |
|----------|---------|
| `tempmail-plus` | API khác trên RapidAPI |
| `imap` | Đọc inbox thật qua IMAP |
| `manual` | User tự nhập email, app chỉ poll IMAP/API |

Steps giống checklist trong [02-architecture.md](./02-architecture.md) — không đụng core.

## UI

- Dropdown **Email Provider** trên màn Register (list từ registry)
- Settings panel dynamic render từ `getConfigSchema()` của provider đang chọn
- Nút **Test**: `createInbox` + hiện email generated
