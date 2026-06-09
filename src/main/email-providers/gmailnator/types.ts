export interface GmailnatorGenerateResponse {
  email?: string
  status?: string
}

export interface GmailnatorInboxItem {
  id: string
  from: string
  subject: string
  timestamp?: number
  time_ago?: string
  content?: string
  html?: string
  text?: string
}

export interface GmailnatorInboxResponse {
  email?: string
  messages?: GmailnatorInboxItem[]
}

export interface GmailnatorMessageResponse {
  id?: string
  from?: string
  subject?: string
  timestamp?: number
  time_ago?: string
  content?: string
  has_attachments?: boolean
  attachments?: unknown[]
}
