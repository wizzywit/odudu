import { describe, expect, it } from 'vitest';
import { agentReaches } from '#/service/agent-reach';

const SYSTEM = '0199aa00-0000-7000-8000-000000000001';
const X = 'tenant-x';
const Y = 'tenant-y';

const agent = { clientId: 'odudu-assistant', ownerSubjectId: 's', viaEndpoint: true as const };
const base = {
  agent,
  issuerTenantId: SYSTEM,
  scopes: ['mcp:read'],
  pathTenantId: X,
  pathTenantEnabled: true,
};
const bound = { ...base, agent: { ...agent, assistantTarget: X } };

describe('where an agent token is admitted', () => {
  it('is its own tenant, for every agent without an assistant target', () => {
    expect(agentReaches({ ...base, pathTenantId: SYSTEM })).toBe(true);
    expect(agentReaches({ ...base, issuerTenantId: X, pathTenantId: X })).toBe(true);
    expect(agentReaches(base)).toBe(false);
  });

  it('is the target alone for the assistant of a system administrator', () => {
    expect(agentReaches(bound)).toBe(true);
    expect(agentReaches({ ...bound, pathTenantId: Y })).toBe(false);
    expect(agentReaches({ ...bound, pathTenantId: SYSTEM })).toBe(false);
  });

  it('needs the marker only the endpoint signs', () => {
    const { viaEndpoint: _unused, ...unmarked } = bound.agent;
    expect(agentReaches({ ...bound, agent: unmarked })).toBe(false);
  });

  it('needs the system tenant as the issuer', () => {
    expect(agentReaches({ ...bound, issuerTenantId: Y })).toBe(false);
    expect(agentReaches({ ...bound, issuerTenantId: X, pathTenantId: X })).toBe(false);
  });

  it('needs an enabled target', () => {
    expect(agentReaches({ ...bound, pathTenantEnabled: false })).toBe(false);
  });

  it('does not admit a token holding the write scope across tenants', () => {
    expect(agentReaches({ ...bound, scopes: ['mcp:read', 'mcp:write'] })).toBe(false);
  });

  it('never treats a target equal to the issuer as a reach', () => {
    const own = { ...bound, agent: { ...agent, assistantTarget: SYSTEM }, pathTenantId: SYSTEM };
    expect(agentReaches(own)).toBe(false);
  });
});
