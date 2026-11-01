import { readFile, glob } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// A renderer takes the page's language as its last argument, so a route that
// forgets to negotiate one cannot leave a page in the default: the call that
// omits it is named here, with nothing going red anywhere else.
async function files(pattern: string): Promise<string[]> {
  const found: string[] = [];
  for await (const file of glob(pattern, {
    cwd: REPO_ROOT,
    exclude: (entry) => path.basename(entry) === 'node_modules',
  })) {
    if (!file.endsWith('.test.ts')) found.push(file);
  }
  return found.sort();
}

function closing(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      at += 1;
      while (at < text.length && text[at] !== quote) at += text[at] === '\\' ? 2 : 1;
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  throw new Error('unbalanced call');
}

function lastArgument(args: string): string {
  let depth = 0;
  let start = 0;
  let last = '';
  for (let at = 0; at < args.length; at += 1) {
    const char = args[at];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      at += 1;
      while (at < args.length && args[at] !== quote) at += args[at] === '\\' ? 2 : 1;
    } else if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      last = args.slice(start, at);
      start = at + 1;
    }
  }
  const tail = args.slice(start);
  return tail.trim() === '' ? last : tail;
}

describe('every route that renders a page passes the negotiated locale', () => {
  it('ends each renderer call with a locale', async () => {
    const names = new Set<string>();
    for (const file of await files('packages/*/src/view/*-html.ts')) {
      const text = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const match of text.matchAll(/^export function (render[A-Z]\w*)\(/gmu)) {
        if (match[1] !== undefined) names.add(match[1]);
      }
    }
    expect(names.size).toBeGreaterThan(20);

    const offences: string[] = [];
    let calls = 0;
    const routes = [
      ...(await files('packages/*/src/view/routes/*.ts')),
      ...(await files('packages/*/src/view/*.ts')),
    ].filter((file) => !file.endsWith('-html.ts'));
    for (const file of routes) {
      const text = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const match of text.matchAll(/(?<![\w.])(render[A-Z]\w*)\(/gu)) {
        const name = match[1] ?? '';
        const before = text.slice(Math.max(0, match.index - 9), match.index);
        if (!names.has(name) || before.endsWith('function ')) continue;
        calls += 1;
        const open = match.index + match[0].length - 1;
        const args = text.slice(open + 1, closing(text, open));
        if (
          !/\blocale\b|brandedRequestLocale\(|requestLocale\(|negotiatePageLocale\(/u.test(
            lastArgument(args),
          )
        ) {
          const line = text.slice(0, match.index).split('\n').length.toString();
          offences.push(`${file}:${line} ${name}`);
        }
      }
    }
    expect(calls).toBeGreaterThan(30);
    expect(offences).toEqual([]);
  });
});

// The theme rides on the negotiated locale, so the one way a page loses it is
// a negotiation that never passes through withPageTheme. The helpers every
// route reads the locale from are the only places that negotiate.
describe('every negotiation of a page locale carries the theme', () => {
  it('passes the result of negotiatePageLocale through withPageTheme', async () => {
    const offences: string[] = [];
    let negotiating = 0;
    const routes = [
      ...(await files('packages/*/src/view/routes/*.ts')),
      ...(await files('packages/*/src/view/*.ts')),
    ].filter((file) => !file.endsWith('-html.ts'));
    for (const file of routes) {
      const text = await readFile(path.join(REPO_ROOT, file), 'utf8');
      for (const match of text.matchAll(/(?<![\w.])negotiatePageLocale\(/gu)) {
        negotiating += 1;
        const open = match.index + match[0].length - 1;
        const before = text.slice(Math.max(0, match.index - 120), match.index);
        const after = text.slice(closing(text, open) + 1, closing(text, open) + 3);
        const wrapper = /withPageTheme\(\s*$/u.exec(before);
        let cookieArgument = false;
        if (wrapper !== null && after.startsWith(',')) {
          const wrapperOpen = match.index - wrapper[0].length + wrapper[0].indexOf('(');
          const wrapperArgs = text.slice(wrapperOpen + 1, closing(text, wrapperOpen));
          cookieArgument = /^\s*(?:reply\.)?request\.headers\.cookie\s*$/u.test(
            lastArgument(wrapperArgs),
          );
        }
        if (!cookieArgument) {
          const line = text.slice(0, match.index).split('\n').length.toString();
          offences.push(
            `${file}:${line} negotiatePageLocale not wrapped in withPageTheme(…, request.headers.cookie)`,
          );
        }
      }
    }
    expect(negotiating).toBeGreaterThanOrEqual(4);
    expect(offences).toEqual([]);
  });
});

// A themeable page asks for its theme through the one branding step. The
// unbranded builders are named at every call site: only the pages with no
// tenant in scope and the three helpers that wrap them may call one.
const NO_TENANT_ROUTES = new Set([
  'packages/protocol-oidc/src/view/routes/throttled.ts',
  'packages/protocol-oidc/src/view/routes/unrouted.ts',
]);
const LOCALE_BUILDERS = new Set([
  'packages/protocol-oidc/src/view/routes/continuation.ts',
  'packages/protocol-oidc/src/view/routes/expired-sign-in.ts',
  'packages/account/src/view/request-locale.ts',
]);
const UNBRANDED_LOCALE = /(?<![\w.])(?:requestLocale|negotiatePageLocale)\(/gu;

// Each call site of an unbranded builder outside the exempt files, and, for
// a helper that builds one, whether it also asks for a theme.
export function unbrandedSites(file: string, text: string): string[] {
  const code = text.replace(/\/\/.*$/gmu, '');
  if (NO_TENANT_ROUTES.has(file)) return [];
  if (LOCALE_BUILDERS.has(file)) {
    return /(?<![\w.])brandLocale\(/u.test(code)
      ? []
      : [`${file} builds a page locale but never calls brandLocale`];
  }
  return [...code.matchAll(UNBRANDED_LOCALE)].map(
    (match) =>
      `${file}:${String(code.slice(0, match.index).split('\n').length)} ${match[0]} is an unbranded page locale`,
  );
}

describe('every page locale a route builds can carry a theme', () => {
  it('names each call site of an unbranded builder', () => {
    const route = 'packages/protocol-oidc/src/view/routes/authorize.ts';
    const mixed =
      'const a = await brandedRequestLocale(deps, reply, t);\nconst b = requestLocale(reply, deps);';
    expect(unbrandedSites(route, mixed)).toEqual([
      `${route}:2 requestLocale( is an unbranded page locale`,
    ]);
    expect(unbrandedSites(route, 'const l = negotiatePageLocale({});')).toHaveLength(1);
    expect(unbrandedSites(route, 'const l = await brandedLocale(request, deps, tenant);')).toEqual(
      [],
    );
    expect(
      unbrandedSites(
        'packages/protocol-oidc/src/view/routes/throttled.ts',
        'render(requestLocale(reply))',
      ),
    ).toEqual([]);
    expect(
      unbrandedSites('packages/account/src/view/request-locale.ts', 'negotiatePageLocale({})'),
    ).toHaveLength(1);
  });

  it('holds for every route of the packages that render tenant pages', async () => {
    const routes = [
      ...(await files('packages/protocol-oidc/src/view/routes/*.ts')),
      ...(await files('packages/account/src/view/routes/*.ts')),
      ...(await files('packages/account/src/view/*.ts')),
    ];
    expect(routes.length).toBeGreaterThan(15);
    const offences: string[] = [];
    for (const file of routes) {
      offences.push(...unbrandedSites(file, await readFile(path.join(REPO_ROOT, file), 'utf8')));
    }
    expect(offences).toEqual([]);
  });

  it('keeps no unbranded locale helper in the account package', async () => {
    const text = await readFile(
      path.join(REPO_ROOT, 'packages/account/src/view/request-locale.ts'),
      'utf8',
    );
    expect(text).not.toMatch(/export function requestLocale\(/u);
    expect(text).toMatch(/export async function brandedLocale\(/u);
  });
});
