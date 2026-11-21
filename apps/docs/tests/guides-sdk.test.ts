import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';
import {
  captionOf,
  excerptProblems,
  importProblems,
  packages,
  type Fence,
} from '#docs/tests/support/sdk-sources.ts';

// The guides that teach an SDK. They show the SDK's code, taken from an
// example, and the requests it makes underneath, and they never send a reader
// to another library for what an SDK does.
const GUIDES = [
  'guides/web-app.md',
  'guides/single-page-app.md',
  'guides/api.md',
  'guides/machine-to-machine.md',
  'guides/connect-claude.md',
];

const WRITTEN_FOR_PAGE = 'written for this page';

interface Block extends Fence {
  caption: string | undefined;
  introduced: boolean;
}

function parse(page: string): { text: string; blocks: Block[]; headings: string[] } {
  const text = readFileSync(path.join(DOCS_ROOT, 'content/en', page), 'utf8').replace(
    /^---\n[\s\S]*?\n---\n/u,
    '',
  );
  const nodes = fromMarkdown(text).children;
  const textOf = (node: { children?: unknown[]; value?: string }): string =>
    node.value ?? (node.children ?? []).map((child) => textOf(child as typeof node)).join('');
  const blocks = nodes.flatMap((node, at): Block[] => {
    if (node.type !== 'code') return [];
    const before = nodes[at - 1];
    return [
      {
        lang: node.lang ?? '',
        meta: node.meta ?? '',
        value: node.value,
        caption: captionOf(before),
        introduced: before?.type === 'paragraph' && textOf(before).includes(WRITTEN_FOR_PAGE),
      },
    ];
  });
  const headings = nodes.filter((node) => node.type === 'heading').map((node) => textOf(node));
  return { text, blocks, headings };
}

const CODE = ['ts', 'tsx', 'js', 'jsx', 'python', 'py'];

describe.each(GUIDES)('%s', (page) => {
  const { text, blocks, headings } = parse(page);

  it('sends the reader to no other library and has no section about doing without an SDK', () => {
    expect(text).not.toMatch(/openid-client|oauth4webapi|hand-roll|no SDK|own SDK/iu);
    expect(headings.filter((heading) => /without (an|the) sdk/iu.test(heading))).toEqual([]);
  });

  it('shows each SDK package it names in a text block', () => {
    const named = new Set([...text.matchAll(/@odudu-io\/([\w-]+)/gu)].map((match) => match[1]));
    const shown = blocks.filter((block) => block.lang === 'text').map((block) => block.value);
    const known = new Set(packages().map((pkg) => pkg.dir));
    for (const name of named) {
      expect(known.has(name ?? ''), `@odudu-io/${name ?? ''} is a package`).toBe(true);
      expect(
        shown.some((value) => value.includes(`@odudu-io/${name ?? ''}`)),
        `@odudu-io/${name ?? ''} is in a text block`,
      ).toBe(true);
    }
  });

  it('takes every code excerpt from an example, or says it is written for the page', () => {
    const problems: string[] = [];
    for (const block of blocks.filter((candidate) => CODE.includes(candidate.lang))) {
      if (block.caption !== undefined) {
        if (!block.caption.startsWith('examples/')) {
          problems.push(`${block.caption} is not in an example`);
        } else {
          problems.push(...excerptProblems(block.caption, block.value));
        }
      } else if (!block.introduced) {
        problems.push(`a ${block.lang} block has neither a "From \`path\`:" caption nor a note`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('imports only what the SDKs export', () => {
    const code = blocks.filter((block) => CODE.includes(block.lang));
    expect(importProblems(code, packages())).toEqual([]);
  });
});

describe('the guides that show SDK code', () => {
  it('show some of it', () => {
    const shown = GUIDES.filter(
      (page) => parse(page).blocks.filter((block) => CODE.includes(block.lang)).length > 0,
    );
    expect(shown).toEqual(
      expect.arrayContaining([
        'guides/web-app.md',
        'guides/single-page-app.md',
        'guides/api.md',
        'guides/machine-to-machine.md',
      ]),
    );
  });
});
