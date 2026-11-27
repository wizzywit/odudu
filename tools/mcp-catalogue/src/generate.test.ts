import { readFile } from 'node:fs/promises';
import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { catalogueText } from '#/generate';
import { CATALOGUE_FILE } from '#/location';

interface Tool {
  readonly name: string;
  readonly scope: string;
  readonly method: string;
  readonly pathTemplate: string;
  readonly kind: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown>;
}

const parsed = (): { tools: Tool[] } => JSON.parse(catalogueText()) as { tools: Tool[] };

describe('the MCP tool catalogue', () => {
  it('mcp-tools.json equals what the generator produces now', async () => {
    expect(await readFile(CATALOGUE_FILE, 'utf8')).toBe(catalogueText());
  }, 30_000);

  it('gives the same bytes every time', () => {
    expect(catalogueText()).toBe(catalogueText());
  }, 30_000);

  it('lists the tools a direct caller may serve, by name', () => {
    const { tools } = parsed();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('update_client_metadata');
    expect(names).not.toContain('create_role');
  }, 30_000);

  it('lists no tool whose audience is the console assistant', () => {
    const assistant = TOOLS.filter((tool) => tool.audience === 'assistant').map(
      (tool) => tool.name,
    );
    const names = parsed().tools.map((tool) => tool.name);
    for (const name of assistant) expect(names, name).not.toContain(name);
  }, 30_000);

  it('addresses each tool by method and path template, writes being PATCH only', () => {
    for (const tool of parsed().tools) {
      expect(tool.pathTemplate.startsWith('/admin/')).toBe(true);
      if (tool.scope === 'mcp:write') expect(tool.method).toBe('PATCH');
      else expect(tool.method).toBe('GET');
    }
  }, 30_000);

  it('carries a JSON Schema for each input and each response', () => {
    for (const tool of parsed().tools) {
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema.$schema, tool.name).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
      expect(tool.outputSchema.type, tool.name).toBe('object');
      expect(tool.outputSchema.$schema, tool.name).toBeUndefined();
    }
  }, 30_000);
});
