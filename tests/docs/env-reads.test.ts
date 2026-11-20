import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_DOCS, OUTSIDE_LOADER_ENV } from '../../packages/kernel/src/docs.js';
import { REPO_ROOT } from './markdown.js';

// Every `ODUDU_*` a production source reads from the environment is either a
// key of the configuration loader or on the page's second table. The stdio
// client reads the two it documents from its own package.
const SOURCES = globSync('{packages/*/src,apps/server/src,sdks/mcp-stdio/src}/**/*.ts', {
  cwd: REPO_ROOT,
  exclude: (entry) => entry.endsWith('.test.ts') || entry.includes('/testing/'),
});

const READ = /\benv(?:\.|\[')(ODUDU_[A-Z_]+)/gu;

function reads(): Set<string> {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const match of text.matchAll(READ)) if (match[1] !== undefined) found.add(match[1]);
  }
  return found;
}

describe('the environment variables the configuration reference lists', () => {
  it('include every ODUDU_ variable a production source reads', () => {
    const known = new Set<string>([
      ...Object.keys(CONFIG_DOCS),
      ...Object.keys(OUTSIDE_LOADER_ENV),
    ]);
    expect(SOURCES.length).toBeGreaterThan(100);
    expect([...reads()].filter((name) => !known.has(name))).toEqual([]);
  });

  it('list outside the loader only variables that are still read', () => {
    const found = reads();
    expect(Object.keys(OUTSIDE_LOADER_ENV).filter((name) => !found.has(name))).toEqual([]);
  });
});
