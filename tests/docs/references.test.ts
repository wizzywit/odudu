import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { plannedGenerated, underGenerated } from './generated-links.js';
import { type Document, loadSource, PROTOCOL_PAGES, REPO_ROOT, scanFences } from './markdown.js';

// Planning the generated reference reads every source page; a loaded runner needs more than five seconds.
vi.setConfig({ testTimeout: 30_000 });

// How many of each kind of reference each document carried when these checks
// were written — a floor, not a count to keep current. The protocol pages
// names no pnpm command; the check still runs over it so that the first one
// added is covered. Links are not here: every document is held to those,
// below, because a link is navigation and is broken whenever it was written.
interface Floors {
  readonly pnpm: number;
  readonly paths: number;
}

const DOCUMENTS: readonly (readonly [name: string, floors: Floors])[] = [
  // The front door names no command and no path outside its links; the checks still run
  // over it so that the first one added is covered.
  ['README.md', { pnpm: 0, paths: 0 }],
  [PROTOCOL_PAGES, { pnpm: 0, paths: 4 }],
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
  const { fenced } = scanFences(document);
  return document.lines.flatMap((line, index) =>
    fenced[index] === true ? [line] : [...line.matchAll(/`([^`]+)`/gu)].map((m) => m[1] ?? ''),
  );
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

// Prose only: `](path)` inside a fenced block is code a reader copies, not a
// link anything renders.
function linkTargets(document: Document): string[] {
  const { fenced } = scanFences(document);
  const targets = new Set<string>();
  for (const [index, line] of document.lines.entries()) {
    if (fenced[index] === true) continue;
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
    const document = loadSource(name);

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
  }
});

// Every Markdown document in the repository, found rather than listed: the
// phase notes were split out of `docs/NEXT.md` into `docs/phases/` one level
// deeper, and four links broke silently because a list of documents to check
// is exactly as current as whoever last remembered to extend it.
const NOT_OURS = new Set(['node_modules', 'dist', 'coverage', '.git', '.superpowers', '.turbo']);

// The docs build writes these from the code and git ignores them; the build
// checks their links itself, and a checkout that has not built has none.
const GENERATED = 'apps/docs/content/en/reference/generated';

// A link into a generated directory has no file to find in a checkout that has not built; the
// docs build checks it as a route, and here it must be a page the generator plans to write.
export function linkResolves(absolute: string, planned: ReadonlySet<string>): boolean {
  return underGenerated(absolute) ? planned.has(absolute) : existsSync(absolute);
}

function everyDocument(): string[] {
  return globSync('**/*.md', {
    cwd: REPO_ROOT,
    exclude: (entry) =>
      NOT_OURS.has(path.basename(entry)) || entry.split(path.sep).join('/').endsWith(GENERATED),
  }).sort();
}

describe('every link in every document resolves', () => {
  const documents = everyDocument();

  it('finds the documents, so a broken glob fails rather than checking nothing', () => {
    expect(documents.length).toBeGreaterThan(80);
  });

  it('covers the ADRs, NEXT, phase notes, specs, the archive, README, CLAUDE and the site source', () => {
    const wanted = [
      'README.md',
      'CLAUDE.md',
      'docs/NEXT.md',
      'docs/README.md',
      'docs/adr/0043-localization-is-a-catalogue-a-negotiation-and-a-set-of-owners.md',
      'docs/phases/p4g.md',
      'docs/superpowers/specs/2026-09-10-odudu-design.md',
      'apps/docs/content/en/roadmap.md',
      'apps/docs/content/en/guides/sign-a-user-in.md',
    ];
    expect(wanted.filter((file) => !documents.includes(file))).toEqual([]);
    expect(documents.some((file) => file.startsWith('docs/archive/'))).toBe(true);
  });

  it('resolves each relative link against the file that makes it', async () => {
    const planned = await plannedGenerated();
    let links = 0;
    const broken: string[] = [];
    for (const name of documents) {
      const document = loadSource(name);
      const from = path.dirname(path.join(REPO_ROOT, name));
      for (const target of linkTargets(document)) {
        links += 1;
        if (!linkResolves(path.resolve(from, target), planned)) broken.push(`${name} -> ${target}`);
      }
    }

    expect(links, 'the link extractor has stopped recognising links').toBeGreaterThan(50);
    expect(broken, 'links to files that are not in this repository').toEqual([]);
    // Reads every document and plans the generated reference, which a loaded
    // runner does in more than the default five seconds.
  });
});

describe('a link into the generated reference', () => {
  const root = path.join(REPO_ROOT, 'apps/docs/content/en/reference/generated');

  it('passes when it names a page the generator plans, on a tree that has not built', async () => {
    const planned = await plannedGenerated();
    expect(planned.has(path.join(root, 'configuration.md'))).toBe(true);
    expect(linkResolves(path.join(root, 'configuration.md'), planned)).toBe(true);
    expect(linkResolves(path.join(root, 'admin-api/subjects/index.md'), planned)).toBe(true);
  });

  it('fails when it names a generated page nothing plans', async () => {
    const planned = await plannedGenerated();
    expect(linkResolves(path.join(root, 'configuraton.md'), planned)).toBe(false);
    expect(linkResolves(path.join(root, 'admin-api/nothing.md'), planned)).toBe(false);
  });

  it('leaves a link outside the generated directories to the file system', async () => {
    const planned = await plannedGenerated();
    expect(linkResolves(path.join(REPO_ROOT, 'README.md'), planned)).toBe(true);
    expect(linkResolves(path.join(REPO_ROOT, 'no-such-file.md'), planned)).toBe(false);
  });
});

// A `docs/....md` path named anywhere a person or a tool might follow it: prose,
// a source comment, a test, a workflow. A link check cannot see these, since
// none is a Markdown link, and moving a document leaves every one of them
// pointing at nothing.
const DOCS_PATH = /(?<![\w/.-])docs\/[\w./-]*[\w]\.md\b/gu;
const SCANNED = /\.(?:md|ts|tsx|js|cjs|mjs|json|ya?ml|sql|sh)$/u;

// The archive records how a phase was planned, including files it intended to
// create and ones since renamed, so its paths are not held to the tree as it
// is. Lint fixtures are sample input for other checks, not documentation.
const NOT_CHECKED = /^(?:docs\/archive\/|tests\/lint\/fixtures\/)/u;

function trackedFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listing
    .split('\0')
    .filter(
      (file) =>
        SCANNED.test(file) && !NOT_CHECKED.test(file) && existsSync(path.join(REPO_ROOT, file)),
    );
}

describe('every docs path a file names exists', () => {
  it('resolves each `docs/....md` reference in every tracked text file', () => {
    let references = 0;
    const missing: string[] = [];
    for (const file of trackedFiles()) {
      const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const match of text.matchAll(DOCS_PATH)) {
        references += 1;
        if (!existsSync(path.join(REPO_ROOT, match[0]))) missing.push(`${file} -> ${match[0]}`);
      }
    }

    expect(references, 'the extractor has stopped recognising docs paths').toBeGreaterThan(100);
    expect(
      [...new Set(missing)],
      'references to documents that are not in this repository',
    ).toEqual([]);
  });
});
