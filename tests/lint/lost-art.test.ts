import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { lostArt } from '../../packages/protocol-oidc/src/view/lost-art.js';

// The not-found drawing is one source, packages/instrument/src/lost.svg, and
// is copied by hand into the server's markup, the docs app and the console.
// Each copy is held to the source's elements and geometry, the way the
// console's staff mark is held to mark.svg. Classes differ by design (the
// console and docs hash theirs) and are compared by role, not by name.
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = readFileSync(path.join(REPO_ROOT, 'packages/instrument/src/lost.svg'), 'utf8');
const COPIES = [
  'apps/docs/src/features/not-found/view/LostArt/LostArt.tsx',
  'apps/admin-console/src/shared/ui/LostArt/LostArt.tsx',
];

interface Node {
  tag: string;
  attributes: Record<string, string>;
  children: Node[];
}

const kebab = (name: string): string => name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);
// Presentation attributes JSX spells in camel case; `pathLength` and `viewBox`
// are camel case in SVG itself.
const KEEP = new Set(['pathLength', 'viewBox']);
const IGNORED = new Set(['class', 'xmlns']);

function fromSvg(text: string): Node {
  const stack: Node[] = [];
  let root: Node | undefined;
  for (const match of text.matchAll(/<(\/?)(\w+)([^<>]*?)(\/?)>/gu)) {
    const [, closing, tag = '', rest = '', selfClosing] = match;
    if (closing === '/') {
      stack.pop();
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of rest.matchAll(/([\w:-]+)="([^"]*)"/gu)) {
      const [, name = '', value = ''] = attribute;
      if (!IGNORED.has(name)) attributes[name] = value;
    }
    const node: Node = { tag, attributes, children: [] };
    stack.at(-1)?.children.push(node);
    root ??= node;
    if (selfClosing !== '/') stack.push(node);
  }
  if (root === undefined) throw new Error('no svg');
  return root;
}

function fromJsx(file: string): Node {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(REPO_ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const convert = (element: ts.JsxElement | ts.JsxSelfClosingElement): Node => {
    const opening = ts.isJsxElement(element) ? element.openingElement : element;
    const attributes: Record<string, string> = {};
    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      const name = attribute.name.getText();
      const value = attribute.initializer;
      if (name === 'className' || value === undefined || !ts.isStringLiteral(value)) continue;
      attributes[KEEP.has(name) ? name : kebab(name)] = value.text;
    }
    const children = ts.isJsxElement(element)
      ? element.children.filter(
          (child): child is ts.JsxElement | ts.JsxSelfClosingElement =>
            ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
        )
      : [];
    return { tag: opening.tagName.getText(), attributes, children: children.map(convert) };
  };
  let found: Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found === undefined && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
      found = convert(node);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found === undefined) throw new Error(`no svg in ${file}`);
  return found;
}

// The classes a node carries, as the roles the stylesheet keys on.
function roles(text: string): string[] {
  return [...text.matchAll(/class="([^"]*)"/gu)].map((m) => m[1] ?? '');
}

describe('the not-found drawing', () => {
  it('is served by the server exactly as the source draws it', () => {
    expect(lostArt(false)).toBe(SOURCE.trim());
    expect(fromSvg(lostArt(true))).toEqual(fromSvg(SOURCE));
    expect(lostArt(true)).toContain('lost lost-calm');
  });

  it.each(COPIES)('is drawn by %s with the source geometry', (file) => {
    expect(fromJsx(file)).toEqual(fromSvg(SOURCE));
  });

  it('is decorative, small and free of text, script and inline style', () => {
    expect(Buffer.byteLength(SOURCE)).toBeLessThan(1024);
    expect(SOURCE).toContain('aria-hidden="true"');
    expect(SOURCE).not.toMatch(/<(title|desc|text|script|style)\b|style=/u);
    expect(roles(SOURCE).length).toBeGreaterThan(5);
  });
});

// The sequence runs twice, back to back, and then rests on its last frame, so
// it stops by itself inside the five seconds WCAG 2.2.2 allows and needs no
// pause control. A pointer over it replays it (a user-initiated replay); a
// reduced-motion preference never plays it. A true loop would need a pause
// control and is a decision for later (docs/phases/p4g.md).
const STYLESHEETS = [
  'packages/instrument/src/pages.css',
  'apps/docs/src/features/not-found/view/LostArt/LostArt.module.css',
  'apps/admin-console/src/shared/ui/LostArt/LostArt.module.css',
];
const ELEMENTS = ['routeA', 'routeB', 'badge', 'staff'];
const MAX_TOTAL_SECONDS = 5;

function declarations(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.:]/gu, (c) => `\\${c}`);
  return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'gu'))].map(
    (m) => m[1] ?? '',
  );
}

function animationOf(css: string, name: string): { seconds: number; count: number } {
  const body = declarations(css, `.${name}`).find((text) => text.includes('animation:')) ?? '';
  const shorthand = /animation:\s*([^;]+);/u.exec(body)?.[1] ?? '';
  return {
    seconds: Number(/(\d+(?:\.\d+)?)s\b/u.exec(shorthand)?.[1] ?? Number.NaN),
    count: Number(/\s(\d+)\s+both\b/u.exec(shorthand)?.[1] ?? Number.NaN),
  };
}

function keyframes(css: string, name: string): string {
  return new RegExp(`@keyframes ${name} \\{`, 'u').test(css)
    ? ((css.split(`@keyframes ${name} {`)[1] ?? '').split('\n}\n')[0] ?? '')
    : '';
}

describe.each(STYLESHEETS)('the drawing in %s', (file) => {
  const css = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const server = file.endsWith('pages.css');
  const name = (element: string): string =>
    server
      ? element.replace(/([A-Z])/gu, (c) => `-${c.toLowerCase()}`).replace(/^/u, 'lost-')
      : element;

  it.each(ELEMENTS)('plays %s twice, inside five seconds in all', (element) => {
    const { seconds, count } = animationOf(css, name(element));
    expect(count).toBe(2);
    expect(seconds * count).toBeLessThanOrEqual(MAX_TOTAL_SECONDS);
    expect(seconds).toBeGreaterThan(0);
  });

  it.each(ELEMENTS)('replays %s under a pointer by naming the same frames again', (element) => {
    const hover = new RegExp(
      `\\.lost:hover \\.${name(element)} \\{\\s*animation-name: ([\\w-]+);`,
      'u',
    ).exec(css);
    const again = hover?.[1] ?? '';
    expect(again).toMatch(/-again$/u);
    const base = again.replace(/-again$/u, '');
    expect(keyframes(css, again)).not.toBe('');
    expect(keyframes(css, again)).toBe(keyframes(css, base));
  });

  it('plays nothing under reduced motion, hovered or not', () => {
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const element of ELEMENTS) {
      expect(media).toContain(`.lost .${name(element)}`);
      expect(media).toContain(`.lost:hover .${name(element)}`);
    }
    expect(media).toContain('animation: none');
  });

  it('moves only transform, opacity and stroke-dashoffset', () => {
    const moved = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}\n/gu)].flatMap((m) =>
      [...(m[1] ?? '').matchAll(/^\s{4}([\w-]+):/gmu)].map((d) => d[1] ?? ''),
    );
    expect(new Set(moved)).toEqual(new Set(['transform', 'opacity', 'stroke-dashoffset']));
  });
});
