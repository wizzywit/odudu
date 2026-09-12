import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, REPO_ROOT, type Document } from './markdown.js';

// How many of each kind of reference each document carried when these checks
// were written — a floor, not a count to keep current. `docs/request-paths.md`
// names no pnpm command and links only within itself; the checks still run
// over it so that the first one added is covered.
interface Floors {
  readonly pnpm: number;
  readonly paths: number;
  readonly links: number;
}

const DOCUMENTS: readonly (readonly [name: string, floors: Floors])[] = [
  ['README.md', { pnpm: 4, paths: 6, links: 6 }],
  ['docs/request-paths.md', { pnpm: 0, paths: 5, links: 0 }],
];

function scriptsOf(packageJson: string): Set<string> {
  const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return new Set();
  const scripts: unknown = (parsed as { scripts?: unknown }).scripts;
  return new Set(typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : []);
}

function workspaceScripts(): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const manifest of globSync('{apps,packages,tools}/*/package.json', { cwd: REPO_ROOT })) {
    const file = path.join(REPO_ROOT, manifest);
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const name: unknown = (parsed as { name?: unknown }).name;
    if (typeof name === 'string') byName.set(name, scriptsOf(file));
  }
  return byName;
}

// pnpm's own subcommands. Only what follows `pnpm` that is *not* one of these
// is read as a script name this repository has to define.
const PNPM_BUILTINS = new Set(['install', 'run', 'exec', 'dlx', 'add', 'remove', 'why', 'store']);

interface Invocation {
  readonly text: string;
  readonly packageName: string | null;
  readonly script: string;
}

// Commands are read from fenced blocks and from inline code, because the
// guide names some in prose and shows others as something to paste.
function commandText(document: Document): string[] {
  const fragments: string[] = [];
  let inFence = false;
  for (const line of document.lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) fragments.push(line);
    else fragments.push(...[...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? ''));
  }
  return fragments;
}

function pnpmInvocations(document: Document): Invocation[] {
  return commandText(document).flatMap((fragment) =>
    [...fragment.matchAll(/\bpnpm (?:--filter (?<filter>\S+) )?(?<script>[a-z][a-z\d:-]*)/gu)]
      .filter((match) => !PNPM_BUILTINS.has(match.groups?.script ?? ''))
      .map((match) => ({
        text: match[0],
        packageName: match.groups?.filter ?? null,
        script: match.groups?.script ?? '',
      })),
  );
}

const FILE_SUFFIX = /\.(?:ts|js|cjs|mjs|sh|ya?ml|json|md|sql|toml|example)$/u;

// Every top-level directory of this repository. A path inside a shell command
// is checked only if it starts with one of these, which is what keeps paths
// inside the container — `node dist/main.js` — out of a check about files on
// disk here. Their existence is asserted so that renaming one fails loudly
// rather than quietly narrowing what this recognises.
const TOP_LEVEL = ['apps', 'docs', 'infra', 'packages', 'tests', 'tools'];

function shapedLikeAFile(token: string): boolean {
  if (!token.includes('/')) return false;
  return FILE_SUFFIX.test(token) || token.endsWith('/') || path.basename(token) === 'Dockerfile';
}

// In prose, a path is recognised by its shape alone — `application/json` and
// `text/plain` name no file type and end in no slash, so neither is one.
function repoPaths(document: Document): string[] {
  const found = new Set<string>();
  for (const line of document.lines) {
    for (const match of line.matchAll(/`([A-Za-z\d_.][A-Za-z\d_./-]*)`/gu)) {
      const token = match[1] ?? '';
      if (shapedLikeAFile(token)) found.add(token);
    }
  }
  for (const fragment of commandText(document)) {
    for (const match of fragment.matchAll(/(?:^|\s)(\.\/)?([A-Za-z\d_][A-Za-z\d_./-]*)/gu)) {
      const token = `${match[1] ?? ''}${match[2] ?? ''}`;
      const first = (match[2] ?? '').split('/')[0] ?? '';
      if (TOP_LEVEL.includes(first) && shapedLikeAFile(token)) found.add(token);
    }
  }
  return [...found];
}

function linkTargets(document: Document): string[] {
  const targets = new Set<string>();
  for (const line of document.lines) {
    for (const match of line.matchAll(/\]\((?<target>[^)\s]+)\)/gu)) {
      const target = match.groups?.target ?? '';
      if (/^[a-z]+:/u.test(target) || target.startsWith('#')) continue;
      targets.add(target.split('#')[0] ?? '');
    }
  }
  return [...targets].filter((target) => target.length > 0);
}

function foundIn<T>(
  document: Document,
  what: string,
  atLeast: number,
  values: readonly T[],
): readonly T[] {
  if (values.length < atLeast) {
    throw new Error(
      `${document.name} names ${String(values.length)} ${what}; at least ` +
        `${String(atLeast)} were there when this check was written, so either they ` +
        `moved out of the document or this extractor stopped recognising them.`,
    );
  }
  return values;
}

describe('what the documents tell a newcomer to run still exists', () => {
  const scripts = workspaceScripts();
  const rootScripts = scriptsOf(path.join(REPO_ROOT, 'package.json'));

  it('still knows this repository by its top-level directories', () => {
    const gone = TOP_LEVEL.filter((directory) => !existsSync(path.join(REPO_ROOT, directory)));

    expect(gone, 'the path check below silently stops seeing anything under these').toEqual([]);
  });

  for (const [name, floors] of DOCUMENTS) {
    const document = loadDocument(name);

    it(`every pnpm script ${name} names is defined`, () => {
      const undefinedScripts = foundIn(
        document,
        'pnpm commands',
        floors.pnpm,
        pnpmInvocations(document),
      )
        .filter((invocation) => {
          const available =
            invocation.packageName === null
              ? rootScripts
              : (scripts.get(invocation.packageName) ?? new Set<string>());
          return !available.has(invocation.script);
        })
        .map((invocation) => invocation.text);

      expect(
        undefinedScripts,
        `${name} tells a reader to run scripts no package.json defines`,
      ).toEqual([]);
    });

    it(`every repository path ${name} names exists`, () => {
      const missing = foundIn(
        document,
        'repository paths',
        floors.paths,
        repoPaths(document),
      ).filter((candidate) => !existsSync(path.join(REPO_ROOT, candidate)));

      expect(missing, `${name} names files that are not in this repository`).toEqual([]);
    });

    it(`every link ${name} makes resolves`, () => {
      const from = path.dirname(path.join(REPO_ROOT, name));
      const broken = foundIn(document, 'links', floors.links, linkTargets(document)).filter(
        (target) => !existsSync(path.resolve(from, target)),
      );

      expect(broken, `${name} links to files that are not in this repository`).toEqual([]);
    });
  }
});
