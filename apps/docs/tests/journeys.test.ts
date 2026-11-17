import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const CONTENT = path.join(DOCS_ROOT, 'content/en');
const GUIDES = path.join(CONTENT, 'guides');
const TRANSCRIPTS = 'reference/transcripts/';
type Root = ReturnType<typeof fromMarkdown>;
type Nodes = Root | Root['children'][number];
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/u;

function parse(file: string): Root {
  return fromMarkdown(readFileSync(file, 'utf8').replace(FRONT_MATTER, ''));
}

function fencedBlocks(file: string): string[] {
  return parse(file)
    .children.filter((node) => node.type === 'code')
    .map((node) => node.value);
}

function links(node: Nodes): string[] {
  const own = node.type === 'link' ? [node.url] : [];
  const children = 'children' in node ? node.children.flatMap((child) => links(child)) : [];
  return [...own, ...children];
}

interface Step {
  readonly page: string;
  readonly heading: string;
  readonly blocks: readonly string[];
  readonly commands: readonly string[];
  readonly transcripts: readonly string[];
}

// A step is the part of a guide under one `##` heading. The transcript pages it
// links are where its excerpts must have come from.
function stepsOf(file: string): Step[] {
  const steps: Step[] = [];
  let current: {
    heading: string;
    blocks: string[];
    commands: string[];
    urls: string[];
  } | null = null;
  const close = (): void => {
    if (current === null) return;
    const base = path.dirname(file);
    steps.push({
      page: path.relative(CONTENT, file),
      heading: current.heading,
      blocks: current.blocks,
      commands: current.commands,
      transcripts: current.urls
        .filter((url) => !/^[a-z]+:|^#/iu.test(url))
        .map((url) => path.resolve(base, url.split('#')[0] ?? ''))
        .filter((resolved) => resolved.startsWith(path.join(CONTENT, TRANSCRIPTS))),
    });
    current = null;
  };
  for (const node of parse(file).children) {
    if (node.type === 'heading' && node.depth === 2) {
      close();
      const text = node.children.map((child) => ('value' in child ? child.value : '')).join('');
      current = { heading: text, blocks: [], commands: [], urls: [] };
    } else if (current !== null) {
      if (node.type === 'code') {
        current.blocks.push(node.value);
        if (node.lang === 'bash') current.commands.push(node.value);
      } else current.urls.push(...links(node));
    }
  }
  close();
  return steps;
}

// The guides that follow one recorded run. The other pages in the directory
// teach by commands a reader runs, held by the docs-run job instead.
const JOURNEYS = [
  'admin-signs-in-and-changes-a-user',
  'read-a-refusal',
  'refresh-and-end-a-session',
  'send-a-person-to-change-a-credential',
  'sign-a-user-in',
];
const journeyPages = JOURNEYS.map((name) => path.join(GUIDES, `${name}.md`));
const steps = journeyPages.flatMap((file) => stepsOf(file));

describe('the journey guides', () => {
  it('has the journeys the adopter needs and enough steps to be a check', () => {
    const onDisk = readdirSync(GUIDES)
      .filter((name) => name.endsWith('.md') && name !== 'index.md')
      .map((name) => path.basename(name, '.md'));
    expect(onDisk.filter((name) => JOURNEYS.includes(name)).sort()).toEqual(JOURNEYS);
    expect(steps.flatMap((step) => step.blocks).length).toBeGreaterThan(25);
  });

  it('takes every excerpt, byte for byte, from a transcript its step links', () => {
    const stray: string[] = [];
    for (const step of steps) {
      const sources = step.transcripts.flatMap((file) => fencedBlocks(file));
      for (const block of step.blocks) {
        if (!sources.some((source) => source.includes(block))) {
          stray.push(`${step.page} "${step.heading}": ${JSON.stringify(block.slice(0, 70))}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });

  it('links each step to the full transcript it excerpts', () => {
    const unlinked = steps
      .filter((step) => step.blocks.length > 0 && step.transcripts.length === 0)
      .map((step) => `${step.page} "${step.heading}"`);
    expect(unlinked).toEqual([]);
  });

  it('shows each command whole: no trailing continuation, quotes closed', () => {
    const broken = steps.flatMap((step) =>
      step.commands.flatMap((command) => {
        const problems: string[] = [];
        if (command.trimEnd().endsWith('\\')) problems.push('ends in a line continuation');
        const singles = command.split("'").length - 1;
        const doubles = command.split('"').length - 1;
        if (singles % 2 === 1 || doubles % 2 === 1) problems.push('has an unclosed quote');
        return problems.map((problem) => `${step.page} "${step.heading}": ${problem}`);
      }),
    );
    expect(broken).toEqual([]);
  });

  it('keeps every excerpt short enough to read in place', () => {
    const long = steps.flatMap((step) =>
      step.blocks
        .filter((block) => block.split('\n').length > 24)
        .map(
          (block) => `${step.page} "${step.heading}": ${String(block.split('\n').length)} lines`,
        ),
    );
    expect(long).toEqual([]);
  });
});

describe('the transcript indexes', () => {
  const root = path.join(CONTENT, 'reference/transcripts');
  const groups = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('finds the three groups', () => {
    expect(groups.sort()).toEqual(['admin-paths', 'console-paths', 'request-paths']);
  });

  it.each(groups)('lists every page of %s on its index, in order', (group) => {
    const order = JSON.parse(
      readFileSync(path.join(root, group, 'order.json'), 'utf8'),
    ) as string[];
    const listed = links(parse(path.join(root, group, 'index.md')))
      .filter((url) => url.startsWith('./'))
      .map((url) => url.slice(2));
    expect(listed).toEqual(order.filter((page) => page !== 'index.md'));
  });
});
