import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '@odudu/protocol-admin';
import { NOT_TOOLS, TOOLS } from '#/service/catalogue';

describe('the catalogue', () => {
  it('lists every tool input as a JSON schema that takes no key it does not name', () => {
    for (const tool of TOOLS) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(schema.type, tool.name).toBe('object');
      expect(schema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('bounds the page size of every list in the schema a client sees', () => {
    const paged = TOOLS.filter((tool) => tool.name.startsWith('list_'));
    expect(paged.length).toBeGreaterThan(10);
    for (const tool of paged) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(schema.properties?.limit, tool.name).toMatchObject({ maximum: 200, minimum: 1 });
    }
  });

  it('has no tool that can write: every tool is a read', () => {
    expect(TOOLS.every((tool) => tool.access === 'read' && tool.routeKey.startsWith('GET '))).toBe(
      true,
    );
  });

  it('takes the tenant from no tool input', () => {
    for (const tool of TOOLS) {
      const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
      expect(Object.keys(schema.properties ?? {}), tool.name).not.toContain('tenant');
    }
  });

  it('keeps the tools and the withheld routes apart', () => {
    for (const tool of TOOLS) expect(NOT_TOOLS, tool.name).not.toHaveProperty([tool.routeKey]);
  });

  it("answers with the schema the route's own contract declares", () => {
    for (const tool of TOOLS) {
      const route = ADMIN_ROUTES.find(
        (candidate) => `${candidate.method} ${candidate.pattern}` === tool.routeKey,
      );
      expect(tool.response, tool.name).toBe(route?.responseSchema);
    }
  });
});
