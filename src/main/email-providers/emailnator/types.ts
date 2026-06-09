export interface EmailnatorGenerateResponse {
  email?: string[]
  message?: string
}

export interface EmailnatorMessageListItem {
  messageID: string
  from: string
  subject: string
  time?: string
}

export interface EmailnatorInboxResponse {
  messageData?: EmailnatorMessageListItem[]
  message?: string
}

