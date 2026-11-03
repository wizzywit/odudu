import { describe, expect, it } from 'vitest';
import { issuerPreview, nameProblem } from '#/pages/tenants/services/tenantName';
import { TENANT_NAME_RULE_TEXT } from '#/shared/services/principal';

describe('the tenant name', () => {
  it('asks for a name, refuses one the rule refuses, and passes a good one', () => {
    expect(nameProblem('')).toBe('Enter a name for the tenant.');
    expect(nameProblem('   ')).toBe(TENANT_NAME_RULE_TEXT);
    expect(nameProblem('A')).toBe(TENANT_NAME_RULE_TEXT);
    expect(nameProblem('Acme')).toBe(TENANT_NAME_RULE_TEXT);
    expect(nameProblem('-acme')).toBe(TENANT_NAME_RULE_TEXT);
    expect(nameProblem('acme-eu')).toBeNull();
  });
});

describe('the issuer preview', () => {
  const SYSTEM = 'https://id.example/tenants/system';

  it("puts the name where the system tenant's issuer has its own", () => {
    expect(issuerPreview(SYSTEM, 'acme')).toBe('https://id.example/tenants/acme');
  });

  it('shows nothing for a name the rule refuses, or an issuer of another shape', () => {
    expect(issuerPreview(SYSTEM, '')).toBeNull();
    expect(issuerPreview(SYSTEM, 'Not A Label')).toBeNull();
    expect(issuerPreview('https://id.example/issuers/system', 'acme')).toBeNull();
    expect(issuerPreview(undefined, 'acme')).toBeNull();
  });
});
