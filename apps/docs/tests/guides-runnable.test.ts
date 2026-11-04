import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

// The pages whose commands the docs-run job executes. The journey guides
// excerpt recorded transcripts instead, and tests/journeys.test.ts holds them.
const PAGES = [
  'quick-start/index.mdx',
  'guides/web-app.md',
  'guides/single-page-app.md',
  'guides/api.md',
  'guides/machine-to-machine.md',
  'guides/keycloak.md',
  'guides/wordpress.md',
  'operating/upgrading.md',
  'operating/backups.md',
  'operating/custom-domains.md',
  'operating/hardening.md',
];

const SHELLS = new Set(['sh', 'bash', 'zsh', 'shell', 'console']);

function blocks(page: string): { lang: string; meta: string }[] {
  const text = readFileSync(path.join(DOCS_ROOT, 'content/en', page), 'utf8');
  return fromMarkdown(text.replace(/^---\n[\s\S]*?\n---\n/u, ''))
    .children.filter((node) => node.type === 'code')
    .map((node) => ({ lang: node.lang ?? '', meta: node.meta ?? '' }));
}

describe('the pages whose commands run in CI', () => {
  it.each(PAGES)('%s tags every shell command runnable, or shows it as text', (page) => {
    const loose = blocks(page).filter(
      (block) => SHELLS.has(block.lang) && !/^\{run(\s|\})/u.test(block.meta),
    );
    expect(loose).toEqual([]);
  });

  it.each(PAGES)('%s has at least one runnable command', (page) => {
    expect(blocks(page).some((block) => block.meta.startsWith('{run'))).toBe(true);
  });
});
