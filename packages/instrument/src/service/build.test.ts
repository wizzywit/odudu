import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildInstrument } from '#/service/build';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const TOKENS = join(ROOT, 'apps/admin-console/src/shared/view');
const read = (path: string): string => readFileSync(path, 'utf8');

const tokensCss = read(join(TOKENS, 'tokens.css'));
const fontsCss = read(join(TOKENS, 'fonts.css'));
const pagesCss = read(join(import.meta.dirname, '..', 'pages.css'));

const requested: string[] = [];
function built(): ReturnType<typeof buildInstrument> {
  return buildInstrument({
    tokensCss,
    fontsCss,
    pagesCss,
    fontFile: (name) => {
      requested.push(name);
      return Buffer.from(`font:${name}`);
    },
  });
}

describe('buildInstrument', () => {
  it('rewrites every font url to /instrument/fonts/<name>.<hash>.woff2', () => {
    const { css, fonts } = built();
    const urls = [...css.matchAll(/url\(([^)]*)\)/gu)].map((match) => match[1] ?? '');
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^'\/instrument\/fonts\/[a-z0-9-]+\.[0-9a-f]{8}\.woff2'$/u);
    }
    expect(css).not.toContain('@fontsource');
    expect(fonts.size).toBe(urls.length);
    for (const url of urls) {
      expect(fonts.has(url.replaceAll("'", '').replace('/instrument/fonts/', ''))).toBe(true);
    }
  });

  it('names a font by its content, so the same bytes keep one name', () => {
    const first = built().fonts;
    const second = built().fonts;
    expect([...first.keys()]).toEqual([...second.keys()]);
    const other = buildInstrument({
      tokensCss,
      fontsCss,
      pagesCss,
      fontFile: (name) => Buffer.from(`changed:${name}`),
    });
    expect([...other.fonts.keys()]).not.toEqual([...first.keys()]);
  });

  it('orders tokens, then fonts, then the page rules', () => {
    const { css } = built();
    expect(css.indexOf('--surface-page:')).toBeLessThan(css.indexOf('@font-face'));
    expect(css.indexOf('@font-face')).toBeLessThan(css.indexOf('var(--surface-page)'));
  });

  it('declares each token the stylesheet uses', () => {
    const declared = new Set(
      [...tokensCss.matchAll(/(?:^|[\s{;])(--[\w-]+)\s*:/gu)].map((match) => match[1]),
    );
    const used = [...pagesCss.matchAll(/var\(\s*(--[\w-]+)/gu)].map((match) => match[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !declared.has(name))).toEqual([]);
  });

  it('uses only logical properties', () => {
    const physical = [
      /\bmargin-(left|right|top|bottom)\b/u,
      /\bpadding-(left|right|top|bottom)\b/u,
      /(^|[\s;{])(left|right|top|bottom)\s*:/u,
      /text-align\s*:\s*(left|right)/u,
      /\bfloat\s*:/u,
      /\bborder-(left|right|top|bottom)\b/u,
    ];
    for (const pattern of physical) expect(pagesCss).not.toMatch(pattern);
  });

  it('names no physical left or right anywhere in the page rules', () => {
    const code = pagesCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(code).not.toMatch(/\b(left|right)\b/iu);
    expect(code).not.toMatch(/\b(translateX|translate3d|scaleX|skewX)\b/u);
    expect(code).not.toMatch(/\bbackground-position(-x)?\s*:/u);
  });

  // The 404 picture is drawn, not set, and its keyframe steps are not rules
  // about direction, so neither is held to the direction checks below.
  const rulesOutsideArt = (): { selector: string; declarations: [string, string][] }[] => {
    const code = pagesCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    return [...code.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .map(([, selector, body]) => ({
        selector: (selector ?? '').trim(),
        declarations: (body ?? '')
          .split(';')
          .map((line): [string, string] => {
            const at = line.indexOf(':');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
          })
          .filter(([name]) => name !== ''),
      }))
      .filter(({ selector }) => !/\.lost-|^((from|to|\d+%)[\s,]*)+$/u.test(selector));
  };

  const valuesOf = (value: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of value) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (/\s/u.test(char) && depth === 0) {
        if (current !== '') parts.push(current);
        current = '';
      } else current += char;
    }
    return current === '' ? parts : [...parts, current];
  };

  // Corners run top-left, top-right, bottom-right, bottom-left; only a start
  // that differs from its end changes when the page is mirrored.
  const cornersMirror = (parts: string[]): boolean => {
    const [tl = '0', tr = tl, br = tl, bl = tr] = parts;
    return tl === tr && br === bl;
  };

  it('reads a border-radius as mirrored only when each side has equal corners', () => {
    expect(cornersMirror(['8px'])).toBe(true);
    expect(cornersMirror(['8px', '8px', '0', '0'])).toBe(true);
    expect(cornersMirror(['0', '0', '8px', '8px'])).toBe(true);
    expect(cornersMirror(['8px', '0'])).toBe(false);
    expect(cornersMirror(['8px', '8px', '0'])).toBe(false);
    expect(cornersMirror(['8px', '0', '0', '0'])).toBe(false);
    expect(cornersMirror(['0', '0', '0', '8px'])).toBe(false);
  });

  it('gives a shorthand the same start and end, so it reads the same mirrored', () => {
    const sided = /^(margin|padding|inset|border-width|border-color|border-style)$/u;
    for (const { selector, declarations } of rulesOutsideArt()) {
      for (const [name, value] of declarations) {
        const parts = valuesOf(value);
        if (sided.test(name) && parts.length === 4) {
          expect(parts[1], `${selector} ${name}`).toBe(parts[3]);
        }
        if (name === 'border-radius' && !value.includes('/')) {
          expect(cornersMirror(parts), `${selector} border-radius has unequal start and end`).toBe(
            true,
          );
        }
      }
    }
  });

  it('positions nothing by an offset that has a side', () => {
    for (const { selector, declarations } of rulesOutsideArt()) {
      for (const [name, value] of declarations) {
        expect(name, selector).not.toMatch(
          /^(background-position(-x)?|object-position|mask-position|translate|transform-origin)$/u,
        );
        if (name === 'transform') expect(value, selector).not.toMatch(/translate\(/u);
        if (name === 'background') expect(value, selector).not.toMatch(/\d(%|px|rem)\s+\d/u);
      }
    }
  });

  it('keeps every other direction-sensitive rule to the two that are neutral', () => {
    const code = pagesCss.replace(/\/\*[\s\S]*?\*\//gu, '');
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
    // A rotation belongs to the 404 page's picture (its rules and keyframes).
    const rotated = rules.filter(([, , body]) => /\brotate\(/u.test(body ?? ''));
    for (const [, selector] of rotated) {
      expect((selector ?? '').trim()).toMatch(/\.lost-|^((from|to|\d+%)[\s,]*)+$/u);
    }
    // Letter-spacing breaks the joining of Arabic letters, so only the Latin
    // brand name may carry it.
    const spaced = rules.filter(([, , body]) => /letter-spacing\s*:/u.test(body ?? ''));
    expect(spaced.map(([, selector]) => (selector ?? '').trim())).toEqual(['.wordmark']);
  });

  it('hides only the logo variant not in use, and never shows the other', () => {
    const rules = [...pagesCss.matchAll(/[^{}]*\.logo\.logo-(?:dark|light)[^{}]*\{([^}]*)\}/gu)];
    expect(rules).toHaveLength(4);
    for (const [, body] of rules) expect((body ?? '').trim()).toBe('display: none;');
    expect(pagesCss).toMatch(/\.logo \{[^}]*max-block-size: 2\.5rem;[^}]*object-fit: contain;/u);
  });

  it('never styles a logo variant by its own class alone, so a later .logo rule cannot win', () => {
    expect(pagesCss).not.toMatch(/(^|[\s,}])\.logo-(dark|light)\b/mu);
  });

  it('stays inside the size budget', () => {
    const { css } = built();
    expect(Buffer.byteLength(css)).toBeLessThan(64 * 1024);
    expect(gzipSync(css).byteLength).toBeLessThan(12 * 1024);
  });

  it('keeps the page rules to 640 lines', () => {
    expect(pagesCss.split('\n').length).toBeLessThanOrEqual(640);
  });

  it('contains no remote url()', () => {
    const { css } = built();
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//u);
    expect(css).not.toMatch(/url\(\s*['"]?data:/u);
    expect(css).not.toContain('@import');
    for (const [, url] of css.matchAll(/url\(([^)]*)\)/gu)) {
      expect(url).toMatch(/^'\/instrument\/fonts\//u);
    }
  });
});
