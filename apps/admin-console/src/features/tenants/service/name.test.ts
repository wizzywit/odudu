import { TENANT_NAME_RULE } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import { issuerPreview, NAME_RULE, nameProblem } from '#/features/tenants/service/name.ts';

describe('the tenant name', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(NAME_RULE.toLowerCase()).toBe(`${TENANT_NAME_RULE}.`);
    expect(NAME_RULE.startsWith('A tenant name')).toBe(true);
  });

  it('asks for a name, refuses one the rule refuses, and passes a good one', () => {
    expect(nameProblem('')).toBe('Enter a name for the tenant.');
    expect(nameProblem('Acme')).toBe(NAME_RULE);
    expect(nameProblem('-acme')).toBe(NAME_RULE);
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
