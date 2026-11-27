import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { TOOLS } from '../../packages/mcp/src/service/catalogue.js';
import {
  activityLine,
  hasPhrase,
  phrasedTools,
} from '../../apps/admin-console/src/widgets/assistant-panel/services/activity-lines.js';

const STATES = ['running', 'waiting', 'done', 'failed', 'denied'] as const;

it('words every tool the assistant can call, from a phrase or from the generic fallback', () => {
  expect(TOOLS.length).toBeGreaterThan(60);
  for (const tool of TOOLS) {
    for (const state of STATES) {
      const line = activityLine({ name: tool.name, state });
      expect(line.text.trim(), `${tool.name} ${state}`).not.toBe('');
      expect(line.text, `${tool.name} ${state}`).not.toContain('_');
    }
  }
});

it('words every write itself, since a person decides on what it says', () => {
  for (const tool of TOOLS.filter((entry) => entry.access === 'write')) {
    expect(hasPhrase(tool.name), tool.name).toBe(true);
  }
});

it('words no tool that is gone', () => {
  const names = new Set(TOOLS.map((tool) => tool.name));
  expect(phrasedTools().filter((name) => !names.has(name))).toEqual([]);
});

it('names, in the approval service, exactly the tools that write', () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../apps/admin-console/src/widgets/assistant-panel/services/approval.ts',
    ),
    'utf8',
  );
  const block = /WRITE_TOOLS[^=]*=\s*new Set\(\[([^\]]*)\]/u.exec(source)?.[1] ?? '';
  const named = [...block.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1] ?? '').sort();
  const writes = TOOLS.filter((tool) => tool.access === 'write')
    .map((tool) => tool.name)
    .sort();
  expect(named).toEqual(writes);
});
