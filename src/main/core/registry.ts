import type { EmailProvider, EmailMeta, SiteMeta, SiteProvider } from '../../shared/contracts'

export class ProviderRegistry {
  private sites = new Map<string, SiteProvider>()
  private emails = new Map<string, EmailProvider>()

  registerSite(provider: SiteProvider): void {
    this.sites.set(provider.id, provider)
  }

  registerEmail(provider: EmailProvider): void {
    this.emails.set(provider.id, provider)
  }

  getSite(id: string): SiteProvider {
    const provider = this.sites.get(id)
    if (!provider) throw new Error(`Site provider not found: ${id}`)
    return provider
  }

  getEmail(id: string): EmailProvider {
    const provider = this.emails.get(id)
    if (!provider) throw new Error(`Email provider not found: ${id}`)
    return provider
  }

  listSites(): SiteMeta[] {
    return Array.from(this.sites.values()).map((s) => ({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      configSchema: s.getConfigSchema()
    }))
  }

  listEmails(): EmailMeta[] {
    return Array.from(this.emails.values()).map((e) => ({
      id: e.id,
      name: e.name,
      configSchema: e.getConfigSchema()
    }))
  }
}
