// What a tenant's mail inherits from its published theme, read again once
// a newer version is published.
// A client's own mail is a different read; an empty `client` is the tenant's.
export function mailBrandingKey(tenant: string, publishedVersion: number, client = '') {
  return ['mail-branding', tenant, publishedVersion, client] as const;
}
