import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import {
  AGENT_WRITE_ROUTES,
  agentBodyAdmitted,
  agentWriteNeedsEndpoint,
  scopeAdmits,
  type AgentWriteRoute,
} from '#/service/agent-scope';
import { agentWriteRoutes, ASSISTANT_WRITE_ROUTES } from '#/service/assistant-write-routes';
import { ADMIN_ROUTES } from '#/service/capability';

const PATTERN = '/admin/tenants/:tenant/domains/:id';
const ASSISTANT_ONLY: readonly AgentWriteRoute[] = [
  { method: 'DELETE', pattern: PATTERN, target: 'none', body: 'fields', fields: [] },
];
const probe = ADMIN_ROUTES.find((entry) => entry.method === 'DELETE' && entry.pattern === PATTERN);
if (probe === undefined) throw new Error('the probe route is gone');
const outside = { clientId: 'c', ownerSubjectId: 's' };
const assistant = { ...outside, assistant: true as const };

describe('the writes the door admits to the assistant alone', () => {
  it('is disjoint from the writes every agent may make', () => {
    const shared = new Set(AGENT_WRITE_ROUTES.map((entry) => `${entry.method} ${entry.pattern}`));
    for (const entry of ASSISTANT_WRITE_ROUTES) {
      expect(shared.has(`${entry.method} ${entry.pattern}`), entry.pattern).toBe(false);
    }
  });

  it('is the shared list alone for an outside agent token', () => {
    expect(agentWriteRoutes(outside, ASSISTANT_ONLY)).toBe(AGENT_WRITE_ROUTES);
  });

  it('adds its own list to the shared one for the built-in assistant client', () => {
    expect(agentWriteRoutes(assistant, ASSISTANT_ONLY)).toEqual([
      ...AGENT_WRITE_ROUTES,
      ...ASSISTANT_ONLY,
    ]);
  });

  it('refuses an outside agent holding mcp:write a route only the assistant has, and admits the assistant', () => {
    const scopes = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];
    const refused = agentWriteRoutes(outside, ASSISTANT_ONLY);
    const admitted = agentWriteRoutes(assistant, ASSISTANT_ONLY);
    expect(scopeAdmits(scopes, probe, false, refused)).toBe(false);
    expect(scopeAdmits(scopes, probe, false, admitted)).toBe(true);
  });

  it('refuses the assistant a route in neither list, and a body field the entry does not name', () => {
    const routes = agentWriteRoutes(assistant, ASSISTANT_ONLY);
    expect(scopeAdmits([MCP_WRITE_SCOPE], probe, false, agentWriteRoutes(assistant, []))).toBe(
      false,
    );
    expect(agentBodyAdmitted(probe, undefined, routes)).toBe(true);
    expect(agentBodyAdmitted(probe, { name: 'x' }, routes)).toBe(false);
  });

  it('holds a removal to the endpoint that counts it', () => {
    expect(agentWriteNeedsEndpoint(probe, agentWriteRoutes(assistant, ASSISTANT_ONLY))).toBe(true);
  });

  it('is admitted for no read scope', () => {
    const routes = agentWriteRoutes(assistant, ASSISTANT_ONLY);
    expect(scopeAdmits([MCP_READ_SCOPE], probe, false, routes)).toBe(false);
  });
});
