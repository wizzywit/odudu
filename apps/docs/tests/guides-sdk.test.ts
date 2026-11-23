import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';
import {
  captionOf,
  excerptProblems,
  importProblems,
  packages,
  REPO_ROOT,
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

const text = (relative: string): string =>
  readFileSync(path.join(DOCS_ROOT, 'content/en', relative), 'utf8');

describe('what the guides and the SDK pages say that a reader acts on', () => {
  it('web-app says completeSignIn does not check the ID token signature', () => {
    expect(text('guides/web-app.md')).toContain(
      '`completeSignIn` does not check the signature of the ID token',
    );
  });

  it('api and node say the tenant address is always in the audience', () => {
    expect(text('guides/api.md')).toContain("always holds the tenant's own address");
    expect(text('sdks/node.md')).toContain(
      "always puts the tenant's own address in a token's `aud`",
    );
    expect(text('guides/api.md')).not.toMatch(/unless a client says otherwise/u);
    expect(text('sdks/node.md')).not.toMatch(/unless the client registers another/u);
  });

  it('connect-claude names odudu help mcp and the --help limit', () => {
    const page = text('guides/connect-claude.md');
    expect(page).toContain('`odudu help mcp`');
    expect(page).toContain('does not take `--help` itself');
  });

  it('single-page-app registers the web origin in a command', () => {
    const commands = parse('guides/single-page-app.md').blocks.filter((block) =>
      block.value.includes('odudu seed client'),
    );
    expect(commands.some((block) => block.value.includes('--web-origin'))).toBe(true);
  });

  it('each install-state sentence says what the reader needs to run the script', () => {
    for (const page of GUIDES) {
      for (const line of text(page).split('\n')) {
        if (line.includes('Until the first release is published') && line.includes('install')) {
          if (line.includes('install.sh')) expect(line, page).toContain('pnpm');
        }
      }
    }
  });

  it('the React block uses only options the react page lists for browser mode', () => {
    const block = parse('guides/single-page-app.md').blocks.find((candidate) =>
      candidate.value.includes("kind: 'browser'"),
    );
    const mode = /mode=\{\{([\s\S]*?)\}\}/u.exec(block?.value ?? '')?.[1] ?? '';
    const used = [...mode.matchAll(/^\s*(\w+):/gmu)].map((match) => match[1] ?? '');
    const react = text('sdks/react.md');
    const table = react.slice(react.indexOf('### `browser` mode'), react.indexOf('### `signIn'));
    const listed = [...table.matchAll(/^\| `(\w+)`/gmu)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(3);
    for (const name of used) expect(listed, name).toContain(name);
  });

  it('no page keeps "Until the first release" once every SDK package is public', () => {
    const sdks = path.join(REPO_ROOT, 'sdks');
    const privates = readdirSync(sdks, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(sdks, entry.name, 'package.json'))
      .filter((file) => existsSync(file))
      .map((file) => (JSON.parse(readFileSync(file, 'utf8')) as { private?: boolean }).private);
    if (privates.every((flag) => flag !== true)) {
      const left = globSync('apps/docs/content/en/**/*.{md,mdx}', { cwd: REPO_ROOT }).filter(
        (file) =>
          readFileSync(path.join(REPO_ROOT, file), 'utf8').includes('Until the first release'),
      );
      expect(left).toEqual([]);
    }
  });
});
