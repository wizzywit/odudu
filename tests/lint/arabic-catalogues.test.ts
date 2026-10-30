import { glob, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHIPPED_LOCALES, negotiatePageLocale } from '../../packages/i18n/src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// ADR 0043: a locale ships only when it is complete. For `ar` that is every
// key of every catalogue, each message carrying the arguments English does,
// and each plural message every form Arabic's six plural categories need.
// What this cannot see: whether the Arabic reads well, which only a reader of
// Arabic can say (RELEASING.md names that step).

interface AstNode {
  type: number;
  value?: string;
  options?: Record<string, { value: AstNode[] }>;
  style?: unknown;
  children?: AstNode[];
}

type MessageFormat = new (message: string, locale: string) => { getAst(): AstNode[] };

const TYPE = { literal: 0, argument: 1, select: 5, plural: 6, pound: 7, tag: 8 } as const;

async function messageFormat(): Promise<MessageFormat> {
  const resolved = createRequire(path.join(REPO_ROOT, 'packages/i18n/package.json')).resolve(
    'intl-messageformat',
  );
  const module = (await import(pathToFileURL(resolved).href)) as {
    IntlMessageFormat: MessageFormat;
  };
  return module.IntlMessageFormat;
}

function withoutLocation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocation);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'location')
      .map(([key, entry]) => [key, withoutLocation(entry)]),
  );
}

// Each argument a message reads, as `name:kind[:style]`. `top` lists those
// outside any plural or select arm, once per occurrence, so a message that
// drops or repeats one is caught; `inArms` is the set read inside arms, which
// Arabic may spread over more arms than English. `pound` says whether `#` is used.
interface Shape {
  top: string[];
  inArms: Set<string>;
  pound: boolean;
  arms: Map<string, { plural: boolean; keys: string[] }>;
}

function shape(nodes: AstNode[], inside = false, out?: Shape): Shape {
  const into: Shape = out ?? { top: [], inArms: new Set(), pound: false, arms: new Map() };
  for (const node of nodes) {
    if (node.type === TYPE.pound) into.pound = true;
    if (node.type === TYPE.literal || node.type === TYPE.pound) continue;
    const name = node.value ?? '';
    const key = `${name}:${String(node.type)}:${JSON.stringify(withoutLocation(node.style ?? null))}`;
    if (inside) into.inArms.add(key);
    else into.top.push(key);
    if (node.type === TYPE.plural || node.type === TYPE.select) {
      into.arms.set(name, {
        plural: node.type === TYPE.plural,
        keys: Object.keys(node.options ?? {}),
      });
    }
    for (const arm of Object.values(node.options ?? {})) shape(arm.value, true, into);
    shape(node.children ?? [], inside, into);
  }
  return into;
}

async function cataloguesInSource(): Promise<string[]> {
  const found: string[] = [];
  for await (const file of glob('packages/*/src/**/*.ts', {
    cwd: REPO_ROOT,
    exclude: (entry) => path.basename(entry) === 'node_modules',
  })) {
    if (file.startsWith('packages/i18n/') || file.endsWith('.test.ts')) continue;
    const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
    if (source.includes('createCatalogue(') || source.includes('createTranslators(')) {
      found.push(file);
    }
  }
  return found.sort();
}

// Names and addresses that stay as they are in every language.
const BRAND = /\b[Oo]dudu\b|https?:\/\/\S+/gu;

const ARABIC_CATEGORIES = new Intl.PluralRules('ar').resolvedOptions().pluralCategories;

describe('Arabic is shipped and complete', () => {
  it('is in SHIPPED_LOCALES', () => {
    expect(SHIPPED_LOCALES).toEqual(['en', 'ar']);
  });

  it('ar has every key en has, in every catalogue', async () => {
    const files = await cataloguesInSource();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const module = (await import(path.join(REPO_ROOT, file))) as Record<string, unknown>;
      const en = module.en as Record<string, string>;
      const ar = module.ar as Record<string, string> | undefined;
      expect(ar, `${file} exports no ar catalogue`).toBeDefined();
      const missing = Object.keys(en).filter((id) => !Object.hasOwn(ar ?? {}, id));
      const extra = Object.keys(ar ?? {}).filter((id) => !Object.hasOwn(en, id));
      expect({ file, missing, extra }).toEqual({ file, missing: [], extra: [] });
      const empty = Object.entries(ar ?? {}).filter(([, text]) => text.trim() === '');
      expect(empty, `${file} has an empty Arabic message`).toEqual([]);
    }
  });

  it('every Arabic message reads the arguments English reads, in the same form', async () => {
    const Format = await messageFormat();
    const problems: string[] = [];
    for (const file of await cataloguesInSource()) {
      const module = (await import(path.join(REPO_ROOT, file))) as Record<string, unknown>;
      const en = module.en as Record<string, string>;
      const ar = module.ar as Record<string, string>;
      for (const [id, source] of Object.entries(en)) {
        const english = shape(new Format(source, 'en').getAst());
        const arabic = shape(new Format(ar[id] ?? '', 'ar').getAst());
        if ([...english.top].sort().join('|') !== [...arabic.top].sort().join('|')) {
          problems.push(`${file} ${id}: arguments differ`);
        }
        const armsOf = (set: Set<string>): string => [...set].sort().join('|');
        if (armsOf(english.inArms) !== armsOf(arabic.inArms)) {
          problems.push(`${file} ${id}: arguments read inside arms differ`);
        }
        if (english.pound !== arabic.pound) problems.push(`${file} ${id}: # used differently`);
        if (ar[id]?.includes("'")) problems.push(`${file} ${id}: literal apostrophe`);
        for (const match of source.match(BRAND) ?? []) {
          const token = match.replace(/[.,;:)}]+$/u, '');
          if (!ar[id]?.includes(token)) problems.push(`${file} ${id}: ${token} not kept`);
        }
        for (const [name, englishArms] of english.arms) {
          const arabicArms = arabic.arms.get(name)?.keys ?? [];
          if (englishArms.plural) {
            const missing = ARABIC_CATEGORIES.filter((category) => !arabicArms.includes(category));
            if (missing.length > 0) {
              problems.push(`${file} ${id}: plural ${name} lacks ${missing.join(', ')}`);
            }
          } else if ([...englishArms.keys].sort().join() !== [...arabicArms].sort().join()) {
            problems.push(`${file} ${id}: select ${name} arms differ`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps no markup in any Arabic message', async () => {
    for (const file of await cataloguesInSource()) {
      const module = (await import(path.join(REPO_ROOT, file))) as Record<string, unknown>;
      for (const [id, text] of Object.entries(module.ar as Record<string, string>)) {
        expect(text, `${file} ${id}`).not.toMatch(/<\/?[A-Za-z]/u);
      }
    }
  });
});

describe('ar pages render dir="rtl" and lang="ar"', () => {
  it('negotiates ar from the browser and gives it a right-to-left direction', () => {
    expect(negotiatePageLocale({ acceptLanguage: 'ar-EG,ar;q=0.9,en;q=0.5' })).toMatchObject({
      tag: 'ar',
      dir: 'rtl',
    });
  });

  it('every package that renders pages writes lang="ar" dir="rtl" on <html>', async () => {
    const locale = negotiatePageLocale({ acceptLanguage: 'ar' });
    for (const pkg of ['account', 'authn-flows', 'console-gateway', 'protocol-oidc']) {
      const document = (await import(
        path.join(REPO_ROOT, `packages/${pkg}/src/view/document.ts`)
      )) as {
        page(title: string, body: string, ...rest: unknown[]): { html: string };
      };
      const { html } = document.page('x', '<p>x</p>', null, [], locale);
      expect(html, pkg).toContain('<html lang="ar" dir="rtl"');
    }
  });
});
