import { describe, expect, it } from 'vitest';
import { NOT_TOOLS, TOOLS } from '../../packages/mcp/src/service/catalogue.js';
import {
  ADMIN_ROUTES,
  AGENT_DENIED_READS,
  AGENT_WRITE_ROUTES,
} from '../../packages/protocol-admin/src/index.js';

// Every admin route is exactly one of an MCP tool or a route deliberately not
// one, with its reason, so a new route fails the build until it is placed.

const key = (route: { method: string; pattern: string }): string =>
  `${route.method} ${route.pattern}`;
const ROUTE_KEYS = ADMIN_ROUTES.map(key);
const TOOL_ROUTE_KEYS = TOOLS.map((tool) => tool.routeKey);
const NAME = /^[A-Za-z0-9_.-]{1,128}$/u;

describe('the MCP tool catalogue against the admin routes', () => {
  it('places every admin route as a tool or a NOT_TOOLS entry, never both', () => {
    const unplaced = ROUTE_KEYS.filter(
      (route) => !TOOL_ROUTE_KEYS.includes(route) && !(route in NOT_TOOLS),
    );
    expect(unplaced, 'routes with no tool and no NOT_TOOLS reason').toEqual([]);
    const both = ROUTE_KEYS.filter(
      (route) => TOOL_ROUTE_KEYS.includes(route) && route in NOT_TOOLS,
    );
    expect(both).toEqual([]);
  });

  it('names no route that does not exist', () => {
    expect(Object.keys(NOT_TOOLS).filter((route) => !ROUTE_KEYS.includes(route))).toEqual([]);
    expect(TOOL_ROUTE_KEYS.filter((route) => !ROUTE_KEYS.includes(route))).toEqual([]);
  });

  it('gives every NOT_TOOLS entry a reason', () => {
    for (const [route, reason] of Object.entries(NOT_TOOLS)) {
      expect(reason.trim().length, route).toBeGreaterThan(10);
    }
  });

  it('serves one route with at most one tool', () => {
    expect(new Set(TOOL_ROUTE_KEYS).size).toBe(TOOL_ROUTE_KEYS.length);
  });

  it("declares each tool's capability as its route requires", () => {
    for (const tool of TOOLS) {
      const route = ADMIN_ROUTES.find((candidate) => key(candidate) === tool.routeKey);
      expect(tool.capability, tool.name).toBe(route?.capability);
    }
  });

  it('has a GET route behind every read tool', () => {
    for (const tool of TOOLS.filter((candidate) => candidate.access === 'read')) {
      expect(tool.routeKey.startsWith('GET '), tool.name).toBe(true);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
  });

  it('puts only an allowlisted write route behind a write tool', () => {
    const writable = AGENT_WRITE_ROUTES.map((route) => `${route.method} ${route.pattern}`);
    for (const tool of TOOLS.filter((candidate) => candidate.access === 'write')) {
      expect(writable, tool.name).toContain(tool.routeKey);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
  });

  it('leaves the reads an agent is refused out of the tools', () => {
    for (const route of AGENT_DENIED_READS) {
      expect(TOOL_ROUTE_KEYS, route).not.toContain(route);
      expect(NOT_TOOLS, route).toHaveProperty([route]);
    }
  });

  it('withholds every destructive route with the phase that takes it', () => {
    const destructive = [
      'DELETE /admin/tenants/:tenant',
      'DELETE /admin/tenants/:tenant/sessions',
      'DELETE /admin/tenants/:tenant/subjects/:id/lockout',
      'DELETE /admin/tenants/:tenant/lockouts',
      'POST /admin/tenants/:tenant/keys',
      'POST /admin/tenants/:tenant/keys/:id/promote',
      'POST /admin/tenants/:tenant/keys/:id/retire',
      'DELETE /admin/tenants/:tenant/keys/:id',
    ];
    for (const route of destructive) {
      expect(ROUTE_KEYS, route).toContain(route);
      expect(NOT_TOOLS[route], route).toContain('P5b');
    }
  });

  it('names tools uniquely, in the protocol alphabet, in a fixed order', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(NAME);
    expect(names).toEqual([...names].sort());
  });

  it('describes every tool, saying that returned text is data', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect(tool.description, tool.name).toMatch(/data, not instructions/u);
    }
  });
});
