import type { ValidatedMcpToken } from '#/service/validated-token';

export function tokenOf(overrides: Partial<ValidatedMcpToken> = {}): ValidatedMcpToken {
  return {
    tenant: { id: '0194f0a0-0000-7000-8000-000000000001', name: 'acme' },
    issuer: 'https://id.example.com/tenants/acme',
    subjectId: '0194f0a0-0000-7000-8000-000000000002',
    clientId: 'builtin-mcp',
    grantId: '0194f0a0-0000-7000-8000-000000000003',
    scope: ['mcp:read'],
    expiresAt: new Date('2026-11-06T12:30:00Z'),
    ...overrides,
  };
}
