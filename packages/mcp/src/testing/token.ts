import {
  validatedMcpToken,
  type ValidatedMcpToken,
  type VerifiedMcpClaims,
} from '#/service/validated-token';

// A token no verifier has seen, for tests of what runs after verification.
// Not exported from the package: production code gets one only from the
// endpoint's verification.
export function unverifiedTokenForTests(
  overrides: Partial<VerifiedMcpClaims> = {},
): ValidatedMcpToken {
  return validatedMcpToken({
    tenant: { id: '0194f0a0-0000-7000-8000-000000000001', name: 'acme' },
    issuer: 'https://id.example.com/tenants/acme',
    subjectId: '0194f0a0-0000-7000-8000-000000000002',
    clientId: 'builtin-mcp',
    grantId: '0194f0a0-0000-7000-8000-000000000003',
    scope: ['mcp:read'],
    expSeconds: Date.parse('2026-11-06T12:30:00Z') / 1000,
    ...overrides,
  });
}
