import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './markdown.js';

const PAGE = 'apps/docs/content/en/sdks/core-without-react.md';
const OIDC = 'sdks/oidc/src';

function repoText(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

const page = (): string => repoText(PAGE).replace(/^---\n[\s\S]*?\n---\n/u, '');

interface Block {
  before: string;
  lang: string;
  value: string;
}

// Each fenced block with the paragraph that stands directly above it.
function blocks(): Block[] {
  const found: Block[] = [];
  for (const match of page().matchAll(
    /(?:^|\n\n)([^\n`][^\n]*(?:\n[^\n]+)*)\n\n```(\w*)\n([\s\S]*?)\n```/gu,
  )) {
    found.push({ before: match[1] ?? '', lang: match[2] ?? '', value: match[3] ?? '' });
  }
  return found;
}

const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();

// What the package exports as a value, from its entry file.
function exported(): Set<string> {
  const index = repoText(`${OIDC}/index.ts`);
  return new Set(
    [...index.matchAll(/^export \{ (\w+) \} from /gmu)].map((match) => match[1] ?? ''),
  );
}

// The codes an OduduError can carry, as the file that defines it spells them.
function codes(): Set<string> {
  const file = repoText(`${OIDC}/services/odudu-error.ts`);
  const lists = file.slice(0, file.indexOf('export type OduduErrorCode'));
  return new Set([...lists.matchAll(/'([a-z]+(?:_[a-z]+)*)'/gu)].map((match) => match[1] ?? ''));
}

const STEPS = [
  'discover',
  'beginSignIn',
  'completeSignIn',
  'refresh',
  'signOutUrl',
  'requestAudience',
  'createTokenSource',
];

describe('the guide to the core without React', () => {
  it('has a title and a description of 50 to 146 characters', () => {
    const front = /^---\n([\s\S]*?)\n---\n/u.exec(repoText(PAGE))?.[1] ?? '';
    expect(front).toMatch(/^title: .+/mu);
    const description =
      /^description: (.+)$/mu.exec(front)?.[1]?.replace(/^['"]|['"]$/gu, '') ?? '';
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(146);
  });

  it.each(STEPS)('names %s, which @odudu-io/oidc exports', (name) => {
    expect(exported().has(name), `${name} is exported`).toBe(true);
    expect(page()).toContain(`\`${name}\``);
  });

  it('calls only functions the package exports', () => {
    const own = new Set([...exported(), 'fetch']);
    const called = blocks()
      .filter((block) => block.lang === 'ts')
      .flatMap((block) => [
        ...block.value.matchAll(
          /\b(discover|beginSignIn|completeSignIn|refresh|requestAudience|signOutUrl|createTokenSource|clientCredentials)\(/gu,
        ),
      ])
      .map((match) => match[1] ?? '');
    expect(called.length).toBeGreaterThan(0);
    for (const name of called) expect(own.has(name), name).toBe(true);
  });

  it('names only error codes that OduduError can carry', () => {
    const errors = page().slice(page().indexOf('\n## Errors'));
    const end = errors.indexOf('\n## ', 3);
    const section = end === -1 ? errors : errors.slice(0, end);
    const named = [...section.matchAll(/`([a-z]+(?:_[a-z]+)+)`/gu)].map((match) => match[1] ?? '');
    expect(named.length).toBeGreaterThan(3);
    for (const code of named) expect(codes().has(code), code).toBe(true);
  });

  it('names the web origin registration the browser needs', () => {
    expect(page()).toContain('--web-origin');
    expect(repoText('examples/_shared/provision.sh')).toContain('--web-origin');
  });

  it('shows each excerpt as it is in an example, and says when a block is only a sketch', () => {
    const problems: string[] = [];
    for (const block of blocks().filter((candidate) => candidate.lang !== 'text')) {
      const caption = /^From `([^`]+)`/u.exec(block.before)?.[1];
      if (caption === undefined) {
        if (!block.before.startsWith('A sketch, not taken from an example:')) {
          problems.push(`a block with no caption starts "${block.value.slice(0, 40)}"`);
        }
        continue;
      }
      if (!/^examples\/(single-page-app|web-app|machine-to-machine)\//u.test(caption)) {
        problems.push(`${caption} is not one of the examples this guide draws on`);
      } else if (!existsSync(path.join(REPO_ROOT, caption))) {
        problems.push(`${caption} does not exist`);
      } else if (!squash(repoText(caption)).includes(squash(block.value))) {
        problems.push(
          `${caption} does not hold the excerpt that starts "${block.value.slice(0, 40)}"`,
        );
      }
    }
    expect(problems).toEqual([]);
    expect(blocks().filter((block) => block.before.startsWith('From `')).length).toBeGreaterThan(2);
  });

  it('links the package page instead of repeating its tables', () => {
    expect(page()).toContain('(./oidc.md');
    expect(page()).not.toMatch(/^\| `(issuer|clientId|redirectUri)`/mu);
  });

  it('links the examples it draws on, and each folder exists', () => {
    for (const example of ['single-page-app', 'web-app']) {
      expect(page()).toContain(`github.com/wizzywit/odudu/tree/main/examples/${example}`);
      expect(existsSync(path.join(REPO_ROOT, 'examples', example, 'README.md'))).toBe(true);
    }
  });
});

describe('the guide to the core without React, read as code and as names', () => {
  it('type-checks every sketch against the package source', () => {
    const sketches = blocks().filter(
      (block) => block.lang === 'ts' && block.before.startsWith('A sketch, not taken'),
    );
    expect(sketches.length).toBeGreaterThan(0);
    const dir = mkdtempSync(path.join(tmpdir(), 'sketch-'));
    try {
      const files = sketches.map((block, index) => {
        const file = path.join(dir, `sketch${String(index)}.ts`);
        writeFileSync(file, `${block.value}\nexport {};\n`);
        return file;
      });
      const oidc = path.join(REPO_ROOT, 'sdks/oidc');
      const program = ts.createProgram(files, {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        types: [],
        paths: {
          '@odudu-io/oidc': [path.join(oidc, 'src/index.ts')],
          '#/*': [path.join(oidc, 'src/*')],
        },
      });
      const problems = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.file?.fileName.startsWith(dir) === true)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      expect(problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('backticks only identifiers the package exports, its types spell, or an error code', () => {
    const words = (text: string): string[] =>
      [...text.matchAll(/\b[A-Za-z]\w*\b/gu)].map((m) => m[0]);
    const known = new Set([
      ...exported(),
      ...codes(),
      ...words(repoText(`${OIDC}/index.ts`)),
      ...words(repoText(`${OIDC}/types.ts`)),
      'sessionStorage',
      'Authorization',
      'OpenID',
    ]);
    const prose = page().replace(/```[\s\S]*?```/gu, '');
    const named = [...prose.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/gu)]
      .map((match) => match[1] ?? '')
      .filter((word) => /[a-z][A-Z]|^[A-Z][a-z]/u.test(word));
    expect(named.length).toBeGreaterThan(10);
    expect(named.filter((word) => !known.has(word))).toEqual([]);
  });
});
