import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  squash,
  type Fence,
} from '#docs/tests/support/sdk-sources.ts';

const PAGE = path.join(DOCS_ROOT, 'content/en/sdks/examples.md');
const EXAMPLES = path.join(REPO_ROOT, 'examples');
const FOLDER_LINK = 'https://github.com/wizzywit/odudu/tree/main/examples/';

const source = readFileSync(PAGE, 'utf8').replace(/^---\n[\s\S]*?\n---\n/u, '');
const tree = fromMarkdown(source);

type Node = (typeof tree.children)[number];

function textOf(node: Node | { children?: Node[]; value?: string }): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node && Array.isArray(node.children)
    ? node.children.map(textOf).join('')
    : '';
}

interface Excerpt {
  caption: string | undefined;
  fence: Fence;
}

interface Section {
  name: string;
  raw: string;
  fences: Fence[];
  excerpts: Excerpt[];
}

// One section per H2 whose whole text is a name in code font, the way the page
// heads each example.
function sections(): Section[] {
  const found: Section[] = [];
  const nodes = tree.children;
  nodes.forEach((node, index) => {
    if (
      node.type !== 'heading' ||
      node.depth !== 2 ||
      node.children.length !== 1 ||
      node.children[0]?.type !== 'inlineCode'
    ) {
      return;
    }
    const end = nodes.findIndex(
      (later, at) => at > index && later.type === 'heading' && later.depth <= 2,
    );
    const body = nodes.slice(index + 1, end < 0 ? undefined : end);
    const from = node.position?.start.offset ?? 0;
    const to = (end < 0 ? undefined : nodes[end]?.position?.start.offset) ?? source.length;
    const fences: Fence[] = [];
    const excerpts: Excerpt[] = [];
    body.forEach((child, at) => {
      if (child.type !== 'code') return;
      const fence = { lang: child.lang ?? '', meta: child.meta ?? '', value: child.value };
      fences.push(fence);
      if (fence.lang === 'text') return;
      const caption = captionOf(body[at - 1]);
      excerpts.push({ caption, fence });
    });
    found.push({ name: textOf(node), raw: source.slice(from, to), fences, excerpts });
  });
  return found;
}

const onPage = sections();

function folders(): string[] {
  return readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

function readme(example: string): string {
  return readFileSync(path.join(EXAMPLES, example, 'README.md'), 'utf8');
}

function sectionOf(example: string): Section {
  const section = onPage.find((candidate) => candidate.name === example);
  if (section === undefined) throw new Error(`the page has no section for ${example}`);
  return section;
}

// The command the example's own README gives for its test.
function testCommand(example: string): string {
  const text = readme(example);
  const dir = path.join(EXAMPLES, example);
  if (existsSync(path.join(dir, 'package.json'))) {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (manifest.scripts?.test === undefined) throw new Error(`${example} has no test script`);
    return 'npm test';
  }
  const python = /\.venv\/bin\/python -m pytest/u.exec(text)?.[0];
  if (python === undefined) throw new Error(`${example} names no test command`);
  return python;
}

function installCommand(example: string): string {
  const command = /\.\.\/_shared\/install(?:-python)?\.sh \.[^`\n]*/u.exec(readme(example))?.[0];
  if (command === undefined) throw new Error(`${example} names no install command`);
  return command.trim();
}

// The SDK column of examples/README.md for one example.
function sdksOf(example: string): string[] {
  const row = readFileSync(path.join(EXAMPLES, 'README.md'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith(`| \`${example}\``));
  if (row === undefined) throw new Error(`examples/README.md has no row for ${example}`);
  const cell = row.split('|').filter((part) => part.trim() !== '')[2] ?? '';
  return [...cell.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? '');
}

// The titles of the tests in an example's test file, as the file spells them.
function testTitles(example: string): string[] {
  const dir = path.join(EXAMPLES, example);
  if (existsSync(path.join(dir, 'test.ts'))) {
    const text = readFileSync(path.join(dir, 'test.ts'), 'utf8');
    return [...text.matchAll(/^test\(\s*(['"])((?:\\.|(?!\1).)*)\1/gmsu)].map(
      (match) => match[2] ?? '',
    );
  }
  const text = readFileSync(path.join(dir, 'test_example.py'), 'utf8');
  return [...text.matchAll(/^(?:async )?def test_(\w+)/gmu)].map((match) =>
    (match[1] ?? '').replaceAll('_', ' '),
  );
}

function testFile(example: string): string {
  return existsSync(path.join(EXAMPLES, example, 'test.ts')) ? 'test.ts' : 'test_example.py';
}

function bulletsOf(section: Section): string[] {
  const list = fromMarkdown(section.raw).children.filter((node) => node.type === 'list');
  return list.flatMap((node) => node.children.map((item) => squash(textOf(item))));
}

describe('the examples page', () => {
  it('has a section for every examples/* directory and none for a missing one', () => {
    expect(onPage.map((section) => section.name).sort()).toEqual(folders());
  });

  it.each(folders().map((name) => [name] as const))(
    'links the folder of %s on GitHub',
    (example) => {
      expect(sectionOf(example).raw).toContain(`(${FOLDER_LINK}${example})`);
    },
  );

  it.each(folders().map((name) => [name] as const))(
    'each section names its test command: %s',
    (example) => {
      const lines = sectionOf(example).fences.flatMap((fence) => fence.value.split('\n'));
      expect(lines).toContain(testCommand(example));
      expect(readme(example)).toContain(testCommand(example));
    },
  );

  it.each(folders().map((name) => [name] as const))(
    '%s shows the install command of its README and runs from its folder',
    (example) => {
      const lines = sectionOf(example)
        .fences.filter((fence) => fence.lang === 'text')
        .flatMap((fence) => fence.value.split('\n'));
      expect(lines).toContain(installCommand(example));
      expect(lines).toContain(`cd examples/${example}`);
    },
  );

  it.each(folders().map((name) => [name] as const))(
    'every command %s shows is one its README or manifest gives',
    (example) => {
      const known = [
        readme(example),
        existsSync(path.join(EXAMPLES, example, 'package.json'))
          ? readFileSync(path.join(EXAMPLES, example, 'package.json'), 'utf8')
          : '',
      ].join('\n');
      const lines = sectionOf(example)
        .fences.filter((fence) => fence.lang === 'text')
        .flatMap((fence) => fence.value.split('\n'))
        .filter((line) => line.trim() !== '' && line !== `cd examples/${example}`);
      for (const line of lines) expect(known, line).toContain(line);
    },
  );

  it.each(folders().map((name) => [name] as const))(
    '%s names the SDKs the examples README lists for it, and its test file',
    (example) => {
      for (const sdk of sdksOf(example))
        expect(sectionOf(example).raw, sdk).toContain(`\`${sdk}\``);
      expect(sectionOf(example).raw).toContain(`\`${testFile(example)}\``);
    },
  );

  it.each(folders().map((name) => [name] as const))(
    '%s lists the title of every test in its test file, and no other',
    (example) => {
      expect(bulletsOf(sectionOf(example)).sort()).toEqual(
        testTitles(example)
          .map((title) => squash(title))
          .sort(),
      );
    },
  );

  it('every code excerpt appears in the example source file its caption names, below no dropped comment', () => {
    const problems: string[] = [];
    let count = 0;
    for (const section of onPage) {
      for (const { caption, fence } of section.excerpts) {
        count += 1;
        if (caption === undefined) {
          problems.push(`${section.name}: a ${fence.lang} block has no "From \`path\`" caption`);
          continue;
        }
        if (!caption.startsWith(`examples/${section.name}/`)) {
          problems.push(`${section.name}: ${caption} is not in the example's folder`);
          continue;
        }
        problems.push(...excerptProblems(caption, fence.value));
      }
    }
    expect(count).toBeGreaterThan(onPage.length);
    expect(problems).toEqual([]);
  });

  it('says what the excerpts leave out: the ID token signature and plain http', () => {
    const intro = source.slice(0, source.indexOf('\n## `'));
    expect(intro).toContain("do not check the ID token's signature");
    expect(intro).toContain('OpenID Connect Core section 3.1.3.7');
    expect(intro).toContain('allowInsecureRequests');
    expect(intro).toContain('allowInsecureIssuers');
    expect(intro).toContain('allow_insecure_issuers');
    expect(intro).toContain('never sets them');
  });

  it('shows a block only as an excerpt or as a text block of commands', () => {
    const odd = onPage.flatMap((section) =>
      section.fences
        .filter((fence) => !['text', 'ts', 'tsx', 'python'].includes(fence.lang))
        .map((fence) => `${section.name}: ${fence.lang || 'untagged'}`),
    );
    expect(odd).toEqual([]);
  });

  it('every identifier an excerpt imports from an SDK is exported by that package', () => {
    const blocks = onPage.flatMap((section) => section.excerpts.map(({ fence }) => fence));
    expect(blocks.some((fence) => fence.value.includes('@odudu-io/'))).toBe(true);
    expect(importProblems(blocks, packages())).toEqual([]);
  });

  it('says what an example needs: the stack, the provisioning script and the install scripts', () => {
    const intro = source.slice(0, source.indexOf('\n## `'));
    expect(intro).toContain('examples/_shared/provision.sh');
    expect(intro).toContain('examples/_shared/install.sh');
    expect(intro).toContain('examples/_shared/install-python.sh');
    for (const script of ['provision.sh', 'install.sh', 'install-python.sh']) {
      expect(existsSync(path.join(EXAMPLES, '_shared', script)), script).toBe(true);
    }
    expect(intro).toMatch(/not on npm or PyPI|not been published/u);
  });
});
