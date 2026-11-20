import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCatalogue, toolsOf } from '#/adapter/catalogue-file';

describe('the catalogue the package ships', () => {
  it('is the generated file, read once for its shape', () => {
    const { tools } = loadCatalogue();
    const names = tools.map((tool) => tool.name);
    expect(tools.length).toBeGreaterThan(60);
    expect(names).toEqual([...names].sort());
    const file = JSON.parse(
      readFileSync(new URL('../mcp-tools.json', import.meta.url), 'utf8'),
    ) as {
      tools: unknown[];
    };
    expect(file.tools).toHaveLength(tools.length);
  });

  it('offers amendments of descriptive text and no other write', () => {
    const writes = loadCatalogue().tools.filter((tool) => tool.scope === 'mcp:write');
    expect(writes.map((tool) => tool.name)).toEqual([
      'update_client_metadata',
      'update_group_description',
      'update_role_description',
      'update_scope_metadata',
      'update_tenant_text_settings',
    ]);
    for (const tool of writes) {
      expect(tool.method).toBe('PATCH');
      expect(tool.spends).toBe('mutating');
    }
  });

  it('makes a tool of each entry, with its schema as the listing', () => {
    const catalogue = loadCatalogue();
    const tools = toolsOf(catalogue);
    expect(tools).toHaveLength(catalogue.tools.length);
    for (const [index, tool] of tools.entries()) {
      expect(tool.inputSchema).toBe(catalogue.tools[index]?.inputSchema);
    }
  });
});
