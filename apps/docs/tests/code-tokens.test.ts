import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { themes } from 'prism-react-renderer';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import codeTokens, { themeCss, tokenize, TOKENS_ATTRIBUTE } from '#docs/plugins/code-tokens.ts';
import { DOCS_ROOT, docsDir, load } from '#docs/tests/support/dist.ts';

describe('the build-time highlighter', () => {
  it('splits a JSON block into lines of plain and classed pieces', () => {
    expect(tokenize('{\n  "a": 1\n}', 'json')).toEqual([
      [['punctuation', '{']],
      ['  ', ['property', '"a"'], ['operator', ':'], ' ', ['number', '1']],
      [['punctuation', '}']],
    ]);
  });

  it('writes nothing for a language it has no grammar for', () => {
    expect(tokenize('echo hi', 'bash')).toBeUndefined();
    expect(tokenize('echo hi', null)).toBeUndefined();
  });

  it('refuses names that only the prototype has, and reads a language in any case', () => {
    expect(tokenize('x', 'constructor')).toBeUndefined();
    expect(tokenize('x', '__proto__')).toBeUndefined();
    expect(tokenize('[1]', 'JSON')).toEqual(tokenize('[1]', 'json'));
  });

  it('keeps every character of the code, lines and blanks included', () => {
    const code = 'select 1;\n\nselect 2;';
    const lines = tokenize(code, 'sql') ?? [];
    const text = lines.map((line) => line.map((p) => (typeof p === 'string' ? p : p[1])).join(''));
    expect(text.join('\n')).toBe(code);
  });

  it('attaches the lines to a fenced block as an attribute, and leaves other blocks alone', () => {
    const json = { type: 'code', lang: 'json', value: '[1]' };
    const shell = { type: 'code', lang: 'sh', value: 'ls' };
    codeTokens()({ type: 'root', children: [json, { type: 'paragraph', children: [shell] }] });
    expect(
      JSON.parse(
        String(
          (json as { data?: { hProperties?: Record<string, unknown> } }).data?.hProperties?.[
            TOKENS_ATTRIBUTE
          ],
        ),
      ),
    ).toEqual([
      [
        ['punctuation', '['],
        ['number', '1'],
        ['punctuation', ']'],
      ],
    ]);
    expect((shell as { data?: unknown }).data).toBeUndefined();
  });
});

describe('the colours of the code blocks', () => {
  it('are the two Prism themes, as classes, in the committed stylesheet', async () => {
    const file = path.join(DOCS_ROOT, 'src/css/code-tokens.css');
    const options = await prettier.resolveConfig(file);
    const expected = await prettier.format(themeCss(themes.github, themes.dracula), {
      ...options,
      parser: 'css',
    });
    expect(readFileSync(file, 'utf8')).toBe(expected);
  });
});

const SURFACES = { light: '#f6f8fa', dark: '#282a36' };
const READABLE = 4.5;
// Dracula sets comments at 3.0:1 on purpose, and the github theme at 2.8:1.
const EXEMPT = new Set(['comment', 'prolog', 'doctype', 'cdata']);

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

interface Rule {
  selector: string;
  color: string | undefined;
}

function hexOf(value: string | undefined): string | undefined {
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(value?.trim() ?? '');
  if (channels === null)
    return /^#[0-9a-fA-F]{6}$/u.test(value?.trim() ?? '') ? value?.trim() : undefined;
  return `#${channels
    .slice(1)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].flatMap(([, selectors = '', body = '']) =>
    selectors.split(',').map((selector) => ({
      selector: selector.trim(),
      color: hexOf(/(?:^|[\s;])color:\s*([^;]+);/u.exec(body)?.[1]),
    })),
  );
}

// The colour a token type resolves to in a mode: the dark rules beat the bare
// ones, a rule scoped to the light mode never applies in the dark, and a type
// no rule colours inherits the block's own colour.
function resolved(
  all: Rule[],
  mode: 'light' | 'dark',
  type: string | undefined,
): string | undefined {
  const applies = all.filter(({ selector, color }) => {
    if (color === undefined) return false;
    const target =
      type === undefined ? /\.theme-code-block pre$/u : new RegExp(`\\.tok-${type}$`, 'u');
    if (!target.test(selector)) return false;
    return mode === 'dark'
      ? !selector.startsWith(":root:not([data-theme='dark'])")
      : !selector.startsWith("[data-theme='dark']");
  });
  const scoped = applies.filter(({ selector }) => selector.startsWith("[data-theme='dark']"));
  return [...(mode === 'dark' && scoped.length > 0 ? scoped : applies)].pop()?.color;
}

describe('the legibility of the code colours', () => {
  const css = readFileSync(path.join(DOCS_ROOT, 'src/css/code-tokens.css'), 'utf8');
  const all = rules(css);
  const types = [
    ...new Set(all.flatMap(({ selector }) => /\.tok-([\w-]+)$/u.exec(selector)?.[1] ?? [])),
  ];

  it.each(['light', 'dark'] as const)(
    'reach 4.5:1 on the %s surface for every token type',
    (mode) => {
      const base = resolved(all, mode, undefined) ?? '#000000';
      const failing = types
        .filter((type) => !EXEMPT.has(type))
        .map((type) => [type, contrast(resolved(all, mode, type) ?? base, SURFACES[mode])] as const)
        .filter(([, ratio]) => ratio < READABLE)
        .map(([type, ratio]) => `${type} ${ratio.toFixed(2)}`);
      expect(failing).toEqual([]);
      expect(contrast(base, SURFACES[mode])).toBeGreaterThanOrEqual(READABLE);
    },
  );
});

describe('the highlighting in a built page', () => {
  it('is in the static markup, and the attribute that carried it is not', () => {
    const area = path.join(docsDir('pages'), 'reference/generated/admin-api/clients');
    const pages = readdirSync(area)
      .filter((name) => /^part-\d+$/u.test(name))
      .map((name) => load(path.join(area, name, 'index.html')));
    expect(pages.length).toBeGreaterThan(0);
    expect(
      pages.reduce((sum, $) => sum + $('pre.language-json span.tok-property').length, 0),
    ).toBeGreaterThan(0);
    for (const $ of pages) {
      expect($('[data-tokens]').length).toBe(0);
      expect($('pre span[class=""]').length).toBe(0);
    }
  });
});
