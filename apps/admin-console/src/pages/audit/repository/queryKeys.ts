export function auditExportKey(tenant: string, query: string) {
  return ['audit-export', tenant, query] as const;
}
