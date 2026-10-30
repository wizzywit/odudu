import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FAVICON_INSET, TOUCH_INSET, insetTransform } from '../../brand/geometry.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BRAND = path.join(REPO_ROOT, 'brand');
const TOKENS = path.join(REPO_ROOT, 'apps/admin-console/src/shared/view/tokens.css');

function read(file: string): string {
  return readFileSync(path.join(BRAND, file), 'utf8');
}

function svgFiles(): string[] {
  return globSync('*.svg', { cwd: BRAND }).sort();
}

function tokenColours(): Set<string> {
  const css = readFileSync(TOKENS, 'utf8');
  return new Set([...css.matchAll(/#[0-9a-f]{6}\b/gu)].map((match) => match[0]));
}

// `--name: light-dark(#light, #dark)` or `--name: #value`.
function tokenPair(name: string): { light: string; dark: string } {
  const css = readFileSync(TOKENS, 'utf8');
  const line = new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(css)?.[1] ?? '';
  const colours = [...line.matchAll(/#[0-9a-f]{6}\b/gu)].map((match) => match[0]);
  const light = colours[0];
  const dark = colours[1] ?? light;
  if (light === undefined || dark === undefined) throw new Error(`no colour for --${name}`);
  return { light, dark };
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function pngSize(file: string): { width: number; height: number; bytes: number } {
  const buffer = readFileSync(path.join(BRAND, file));
  const signature = buffer.subarray(0, 8).toString('hex');
  expect(signature, `${file} is a PNG`).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

interface Mark {
  ring: { cx: number; cy: number; r: number };
  shaft: { x: number; from: number; to: number };
  crossbar: { y: number; from: number; to: number };
  strokeWidth: number;
}

interface Raster {
  width: number;
  height: number;
  at(x: number, y: number): [number, number, number, number];
}

// Chromium writes 8-bit RGB or RGBA, non-interlaced, with all five row filters.
function decodePng(file: string): Raster {
  const buffer = readFileSync(path.join(BRAND, file));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colourType = buffer[25];
  expect([buffer[24], buffer[28]], `${file} is 8-bit, not interlaced`).toEqual([8, 0]);
  expect([2, 6], `${file} is RGB or RGBA`).toContain(colourType);
  const bytes = colourType === 6 ? 4 : 3;
  const data: Buffer[] = [];
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    if (buffer.subarray(at + 4, at + 8).toString('latin1') === 'IDAT') {
      data.push(buffer.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bytes;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= bytes ? (out[y * stride + x - bytes] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= bytes && y > 0 ? (out[(y - 1) * stride + x - bytes] ?? 0) : 0;
      const paeth = (): number => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter] ?? 0;
      out[y * stride + x] = (value + predictor) & 255;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const start = (y * width + x) * bytes;
      const alpha = bytes === 4 ? (out[start + 3] ?? 0) : 255;
      return [out[start] ?? 0, out[start + 1] ?? 0, out[start + 2] ?? 0, alpha];
    },
  };
}

// Within what anti-aliasing at a ring's edge can move a colour.
function near(actual: string, expected: string, tolerance = 30): boolean {
  return [1, 3, 5].every(
    (at) =>
      Math.abs(
        Number.parseInt(actual.slice(at, at + 2), 16) -
          Number.parseInt(expected.slice(at, at + 2), 16),
      ) <= tolerance,
  );
}

function hexOf([r, g, b]: readonly number[]): string {
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

function parseMark(svg: string): Mark {
  const circle = /<circle cx="(\d+)" cy="(\d+)" r="(\d+)"[^>]*\/>/u.exec(svg);
  const shaft = /<path d="M(\d+) (\d+)V(\d+)"\/>/u.exec(svg);
  const crossbar = /<path d="M(\d+) (\d+)H(\d+)"\/>/u.exec(svg);
  const width = /stroke-width="(\d+)"/u.exec(svg);
  if (!circle || !shaft || !crossbar || !width) throw new Error('mark.svg is not ring, shaft, bar');
  const n = (value: string | undefined): number => Number(value);
  return {
    ring: { cx: n(circle[1]), cy: n(circle[2]), r: n(circle[3]) },
    shaft: { x: n(shaft[1]), from: n(shaft[2]), to: n(shaft[3]) },
    crossbar: { y: n(crossbar[2]), from: n(crossbar[1]), to: n(crossbar[3]) },
    strokeWidth: n(width[1]),
  };
}

function segmentDistance(
  px: number,
  py: number,
  [x1, y1, x2, y2]: [number, number, number, number],
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Area coverage of one output pixel, by sampling the mark's own geometry.
function coverage(mark: Mark, size: number, pixelX: number, pixelY: number): number {
  const scale = 32 / size;
  const samples = 8;
  let inside = 0;
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const x = (pixelX + (sx + 0.5) / samples) * scale;
      const y = (pixelY + (sy + 0.5) / samples) * scale;
      const half = mark.strokeWidth / 2;
      const onRing = Math.abs(Math.hypot(x - mark.ring.cx, y - mark.ring.cy) - mark.ring.r) <= half;
      const onShaft =
        segmentDistance(x, y, [mark.shaft.x, mark.shaft.from, mark.shaft.x, mark.shaft.to]) <= half;
      const onBar =
        segmentDistance(x, y, [
          mark.crossbar.from,
          mark.crossbar.y,
          mark.crossbar.to,
          mark.crossbar.y,
        ]) <= half;
      if (onRing || onShaft || onBar) inside += 1;
    }
  }
  return inside / (samples * samples);
}

interface JsxMark {
  circle: { cx: number; cy: number; r: number } | undefined;
  paths: string[];
  strokeWidth: number | undefined;
  linecap: string | undefined;
}

// The mark as the console's JSX draws it, read from attributes rather than
// from how the source happens to be formatted.
function jsxMark(source: string): JsxMark {
  const file = ts.createSourceFile(
    'BrandLine.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: JsxMark = {
    circle: undefined,
    paths: [],
    strokeWidth: undefined,
    linecap: undefined,
  };
  const attribute = (
    node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
    name: string,
  ): string | undefined => {
    for (const property of node.attributes.properties) {
      if (ts.isJsxAttribute(property) && property.name.getText() === name) {
        const value = property.initializer;
        if (value !== undefined && ts.isStringLiteral(value)) return value.text;
      }
    }
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (tag === 'circle') {
        found.circle = {
          cx: Number(attribute(node, 'cx')),
          cy: Number(attribute(node, 'cy')),
          r: Number(attribute(node, 'r')),
        };
      }
      if (tag === 'path') found.paths.push(attribute(node, 'd') ?? '');
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText() === 'svg') {
      const width = attribute(node, 'strokeWidth');
      found.strokeWidth = width === undefined ? undefined : Number(width);
      found.linecap = attribute(node, 'strokeLinecap');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Exported functions of a renderer file that neither call page() nor call a
// function of the same file that does.
function exportsWithoutPage(source: string): string[] {
  const file = ts.createSourceFile('x-html.ts', source, ts.ScriptTarget.Latest, true);
  const calls = new Map<string, Set<string>>();
  const exported: string[] = [];
  const register = (name: string, body: ts.Node, isExported: boolean): void => {
    const called = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        called.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(body);
    // A sender takes a page already rendered, so its markup came through page().
    if (
      ts.isFunctionDeclaration(body) &&
      body.parameters.some((parameter) => parameter.type?.getText() === 'RenderedPage')
    ) {
      called.add('page');
    }
    calls.set(name, called);
    if (isExported) exported.push(name);
  };
  for (const statement of file.statements) {
    const isExported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      register(statement.name.text, statement, isExported);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
          register(declaration.name.text, declaration.initializer, isExported);
        }
      }
    }
  }
  const reaches = (name: string, seen = new Set<string>()): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const called = calls.get(name) ?? new Set<string>();
    return called.has('page') || [...called].some((next) => calls.has(next) && reaches(next, seen));
  };
  return exported.filter((name) => !reaches(name));
}

describe('brand assets: every SVG', () => {
  it('ships the files the brand directory lists', () => {
    for (const file of [
      'mark.svg',
      'wordmark.svg',
      'lockup.svg',
      'favicon.svg',
      'favicon.ico',
      'social.svg',
      'social.png',
      'apple-touch-icon.png',
      'README.md',
    ]) {
      expect(existsSync(path.join(BRAND, file)), file).toBe(true);
    }
  });

  it('has a viewBox, a title and a description, and nothing that executes or fetches', () => {
    const files = svgFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const svg = read(file);
      expect(svg, `${file} viewBox`).toMatch(/<svg [^>]*viewBox="[\d. -]+"/u);
      expect(svg, `${file} title`).toMatch(/<title>[^<]+<\/title>/u);
      expect(svg, `${file} desc`).toMatch(/<desc>[^<]+<\/desc>/u);
      expect(svg, `${file} script`).not.toMatch(/<script/iu);
      expect(svg, `${file} style attribute`).not.toMatch(/\sstyle=/iu);
      expect(svg, `${file} style element`).not.toMatch(/<style/iu);
      expect(svg, `${file} image`).not.toMatch(/<image/iu);
      expect(svg, `${file} link`).not.toMatch(/href=|url\(|@import|@font-face|font-family/iu);
      expect(svg, `${file} text`).not.toMatch(/<text/iu);
    }
  });

  it('takes colours only from the Instrument tokens, or from the surrounding text colour', () => {
    const allowed = tokenColours();
    for (const file of svgFiles()) {
      const svg = read(file);
      const values = [...svg.matchAll(/\b(?:fill|stroke|stop-color)="([^"]+)"/gu)].map(
        (match) => match[1] ?? '',
      );
      for (const value of values) {
        const ok = value === 'currentColor' || value === 'none' || allowed.has(value);
        expect(ok, `${file}: ${value} is not an Instrument token`).toBe(true);
      }
    }
  });

  it('draws the two fixed-ink marks in the Instrument inks for each theme', () => {
    expect(read('mark-ink.svg')).toContain(tokenPair('ink-primary').light);
    expect(read('mark-paper.svg')).toContain(tokenPair('ink-primary').dark);
  });

  it('draws lockup-paper.svg as lockup.svg in the Instrument paper colour', () => {
    const body = (svg: string): string => svg.slice(svg.indexOf('<g '));
    const paper = tokenPair('ink-primary').dark;
    expect(body(read('lockup-paper.svg'))).toBe(
      body(read('lockup.svg')).replaceAll('currentColor', paper),
    );
  });

  it('keeps the mark, wordmark and lockup to one colour so they theme', () => {
    for (const file of ['mark.svg', 'wordmark.svg', 'lockup.svg']) {
      expect(read(file), file).not.toMatch(/#[0-9a-f]{6}/iu);
    }
  });
});

describe('brand assets: the staff mark', () => {
  const mark = parseMark(read('mark.svg'));

  it('sets one stroke width, once, on a group, with round caps and no fill', () => {
    const svg = read('mark.svg');
    expect(svg.match(/stroke-width=/gu)).toHaveLength(1);
    expect(svg).toMatch(/<g [^>]*stroke-width="2"/u);
    expect(svg).toMatch(/<g [^>]*stroke-linecap="round"/u);
    expect(svg).toMatch(/<g [^>]*fill="none"/u);
    expect(mark.strokeWidth).toBe(2);
  });

  it('is symmetric about the vertical centre line of a 32 grid', () => {
    expect(read('mark.svg')).toContain('viewBox="0 0 32 32"');
    expect(mark.shaft.x).toBe(16);
    expect(mark.ring.cx).toBe(16);
    expect((mark.crossbar.from + mark.crossbar.to) / 2).toBe(16);
  });

  it('sits on whole grid units, with the crossbar a collar just under the ring', () => {
    const numbers = [
      ...Object.values(mark.ring),
      ...Object.values(mark.shaft),
      ...Object.values(mark.crossbar),
    ];
    expect(numbers.every(Number.isInteger)).toBe(true);
    expect(mark.crossbar.y - (mark.ring.cy + mark.ring.r)).toBeGreaterThanOrEqual(
      2 * mark.strokeWidth,
    );
    expect(mark.crossbar.to - mark.crossbar.from).toBeGreaterThanOrEqual(4 * mark.strokeWidth);
  });

  it('keeps the crossbar in the top quarter of the shaft, so it reads as a sceptre', () => {
    const length = mark.shaft.to - mark.shaft.from;
    const down = (mark.crossbar.y - mark.shaft.from) / length;
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThanOrEqual(0.25);
  });

  it('starts the shaft on the ring, so its cap does not poke into the hole', () => {
    expect(mark.shaft.from).toBeGreaterThanOrEqual(mark.ring.cy + mark.ring.r);
  });

  it('stays inside the grid with the stroke, so nothing clips', () => {
    const half = mark.strokeWidth / 2;
    expect(mark.ring.cy - mark.ring.r - half).toBeGreaterThanOrEqual(0);
    expect(mark.shaft.to + half).toBeLessThanOrEqual(32);
    expect(mark.crossbar.from - half).toBeGreaterThanOrEqual(0);
    expect(mark.crossbar.to + half).toBeLessThanOrEqual(32);
  });

  it('has a ring whose hole stays open and a shaft that stays continuous at 16 px', () => {
    const size = 16;
    const holeX = Math.floor(mark.ring.cx / 2);
    const holeY = Math.floor(mark.ring.cy / 2);
    expect(coverage(mark, size, holeX, holeY)).toBe(0);
    for (let y = 6; y < 14; y += 1) {
      const row = coverage(mark, size, 7, y) + coverage(mark, size, 8, y);
      expect(row, `shaft row ${String(y)}`).toBeGreaterThanOrEqual(0.95);
    }
    const bar = Math.floor(mark.crossbar.y / 2);
    const barCover = [6, 7, 8, 9].map(
      (x) => coverage(mark, size, x, bar - 1) + coverage(mark, size, x, bar),
    );
    expect(Math.max(...barCover)).toBeGreaterThanOrEqual(0.9);
  });

  it('holds its ring open at the smallest size it is shipped', () => {
    const innerRadius = mark.ring.r - mark.strokeWidth / 2;
    expect((innerRadius * 16) / 32).toBeGreaterThanOrEqual(1.5);
  });
});

describe('brand assets: contrast on Instrument surfaces', () => {
  it('reads at 4.5:1 or better in light and dark', () => {
    const pairs: [string, string][] = [
      ['ink-primary', 'surface-page'],
      ['ink-primary', 'surface-panel'],
      ['ink-rail', 'surface-rail'],
    ];
    for (const [ink, surface] of pairs) {
      const a = tokenPair(ink);
      const b = tokenPair(surface);
      expect(contrast(a.light, b.light), `${ink} on ${surface}, light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(a.dark, b.dark), `${ink} on ${surface}, dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws the favicon and social image in the pairs checked above', () => {
    const rail = tokenPair('surface-rail').light;
    const ink = tokenPair('ink-rail').light;
    for (const file of ['favicon.svg', 'social.svg']) {
      const svg = read(file);
      expect(svg, file).toContain(rail);
      expect(svg, file).toContain(ink);
    }
  });
});

describe('brand assets: wordmark', () => {
  it('is the lowercase word odudu, drawn as five outlines', () => {
    const svg = read('wordmark.svg');
    expect(svg).toContain('<title>odudu</title>');
    const paths = [...svg.matchAll(/<path d="(M[^"]+)"\/>/gu)];
    expect(paths).toHaveLength(5);
    for (const found of paths) expect(found[1]?.length ?? 0).toBeGreaterThan(80);
  });

  it('puts the mark and the wordmark on one baseline in the lockup', () => {
    const lockup = read('lockup.svg');
    expect(lockup).toContain('viewBox="0 0 ');
    expect(lockup.match(/<path d="M[^"]+Z"\/>/gu)).toHaveLength(5);
    expect(lockup).toContain('stroke-width="2"');
  });

  it('records the font licence beside the outlines', () => {
    const readme = read('README.md');
    expect(readme).toContain('IBM Plex Mono');
    expect(readme).toContain('SIL Open Font License');
    expect(existsSync(path.join(BRAND, 'LICENSE-IBM-Plex-Mono.txt'))).toBe(true);
  });
});

describe('brand assets: derivatives', () => {
  it('keeps favicon.svg under 1 KB', () => {
    expect(Buffer.byteLength(read('favicon.svg'))).toBeLessThan(1024);
  });

  it('exports the social image at 1200 x 630 under 300 KB', () => {
    const { width, height, bytes } = pngSize('social.png');
    expect([width, height]).toEqual([1200, 630]);
    expect(bytes).toBeLessThan(300 * 1024);
  });

  it('exports the touch icon at 180 x 180', () => {
    const { width, height } = pngSize('apple-touch-icon.png');
    expect([width, height]).toEqual([180, 180]);
  });

  it('packs 16, 32 and 48 px images into favicon.ico', () => {
    const buffer = readFileSync(path.join(BRAND, 'favicon.ico'));
    expect(buffer.readUInt16LE(0)).toBe(0);
    expect(buffer.readUInt16LE(2)).toBe(1);
    const count = buffer.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => buffer.readUInt8(6 + index * 16));
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe('brand assets: every copy of the mark is the mark', () => {
  const source = parseMark(read('mark.svg'));

  it.each([
    'lockup.svg',
    'lockup-paper.svg',
    'favicon.svg',
    'social.svg',
    'mark-ink.svg',
    'mark-paper.svg',
  ])('draws the ring, the shaft and the collar of mark.svg in %s', (file) => {
    const svg = read(file);
    expect(svg.match(/<circle /gu), `${file} circles`).toHaveLength(1);
    expect(svg.match(/<path d="M\d+ \d+[HV]\d+"\/>/gu), `${file} strokes`).toHaveLength(2);
    expect(parseMark(svg), file).toEqual(source);
  });

  it('places the mark in the favicon and the touch icons inside their tiles', () => {
    expect(read('favicon.svg')).toContain(insetTransform(FAVICON_INSET));
    expect(FAVICON_INSET.offset + FAVICON_INSET.scale).toBeLessThanOrEqual(32);
    expect(TOUCH_INSET.offset).toBeGreaterThan(FAVICON_INSET.offset);
    expect(TOUCH_INSET.scale).toBeLessThan(FAVICON_INSET.scale);
  });

  it('keeps the wordmark off the mark by less than the mark is wide', () => {
    const shift = /<g fill="currentColor" transform="translate\((\d+) 0\)">/u.exec(
      read('lockup.svg'),
    )?.[1];
    expect(Number(shift)).toBeLessThanOrEqual(34);
    expect(read('lockup.svg')).toContain(`viewBox="0 0 ${String(Number(shift) + 76)} 32"`);
  });
});

describe('brand assets: the amber ring', () => {
  const amber = tokenPair('signal-system-ink').dark;
  const rail = tokenPair('surface-rail').light;
  const ink = tokenPair('ink-rail').light;
  const source = parseMark(read('mark.svg'));

  it('reads against the rail at 3:1 or better, as a graphic must', () => {
    expect(contrast(amber, rail)).toBeGreaterThanOrEqual(3);
  });

  // A pixel of the mark's own grid, through the tile's inset.
  function pixelAt(
    raster: Raster,
    grid: { offset: number; scale: number },
    tile: number,
    x: number,
    y: number,
  ): string {
    const unit = raster.width / tile;
    const at = (value: number): number => Math.floor((grid.offset + grid.scale * value) * unit);
    return hexOf(raster.at(at(x), at(y)));
  }

  it.each([
    ['apple-touch-icon.png', TOUCH_INSET],
    ['icon-512.png', TOUCH_INSET],
  ] as const)('is one continuous amber annulus in %s, shaft cap included', (file, inset) => {
    const raster = decodePng(file);
    for (let degrees = 0; degrees < 360; degrees += 10) {
      const angle = (degrees * Math.PI) / 180;
      const x = source.ring.cx + source.ring.r * Math.cos(angle);
      const y = source.ring.cy + source.ring.r * Math.sin(angle);
      expect(
        near(pixelAt(raster, inset, 32, x, y), amber),
        `${file} at ${String(degrees)} degrees`,
      ).toBe(true);
    }
    expect(pixelAt(raster, inset, 32, source.ring.cx, source.ring.cy)).toBe(rail);
    expect(pixelAt(raster, inset, 32, 16, 25)).toBe(ink);
    expect(pixelAt(raster, inset, 32, 19, source.crossbar.y)).toBe(ink);
  });

  it('is the same annulus in the social image', () => {
    const raster = decodePng('social.png');
    expect([raster.width, raster.height]).toEqual([1200, 630]);
    const grid = { offset: 0, scale: 5 };
    const at = (value: number, origin: number): number => Math.floor(origin + grid.scale * value);
    for (let degrees = 0; degrees < 360; degrees += 10) {
      const angle = (degrees * Math.PI) / 180;
      const x = at(source.ring.cx + source.ring.r * Math.cos(angle), 120);
      const y = at(source.ring.cy + source.ring.r * Math.sin(angle), 170);
      expect(near(hexOf(raster.at(x, y)), amber), `${String(degrees)} degrees`).toBe(true);
    }
  });
});

// The pixel rebuild launches Chromium. A job with none skips it, by name and with
// the reason; the job that installs Chromium sets ODUDU_REQUIRE_CHROMIUM=1, and
// there a missing browser fails the test like any other failure.
const REQUIRED = process.env.ODUDU_REQUIRE_CHROMIUM === '1';
const NO_BROWSER = "Executable doesn't exist";

describe('brand assets: the derivatives come from the SVGs', () => {
  it('rebuilds the PNGs and the ICO from the SVGs and finds them as committed', (context) => {
    try {
      const output = execFileSync(process.execPath, ['brand/build.ts', '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90_000,
      });
      expect(output).toContain('brand derivatives reproduced');
    } catch (error) {
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error
          ? String(error.stderr)
          : '';
      if (!REQUIRED && stderr.includes(NO_BROWSER)) {
        context.skip('no Chromium is installed here; the docs job requires it');
      }
      throw error;
    }
  }, 100_000);
});

describe('brand assets: the README', () => {
  it('sends a reader to the owner notice and the trademark policy', () => {
    const readme = read('README.md');
    expect(readme).toContain('(NOTICE.md)');
    expect(readme).toContain('(../TRADEMARK.md)');
    expect(existsSync(path.join(BRAND, 'NOTICE.md'))).toBe(true);
  });

  it('records the owner approving the collar crossbar on 2026-10-21', () => {
    const readme = read('README.md');
    expect(readme).toContain('2026-10-21');
    expect(readme).toMatch(/Venus/u);
    expect(readme).toMatch(/sceptre/u);
  });

  it("says the shaft starts on the ring's lower stroke", () => {
    expect(read('README.md').replaceAll(/\s+/gu, ' ')).toContain(
      "starts on the ring's lower stroke",
    );
  });

  it('no longer calls anything proposed', () => {
    for (const file of [...svgFiles(), 'README.md']) {
      expect(read(file), file).not.toMatch(/proposed|awaiting owner/iu);
    }
  });
});

const FAVICON_LINKS = [
  '<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml"',
  '<link rel="icon" href="/instrument/favicon.ico" sizes="48x48"',
];

describe('the copies every page and the console link', () => {
  it('serve the touch icon the brand directory builds', () => {
    const served = readFileSync(
      path.join(REPO_ROOT, 'packages/instrument/src/apple-touch-icon.png'),
    );
    expect(served.equals(readFileSync(path.join(BRAND, 'apple-touch-icon.png')))).toBe(true);
  });

  it('serve the favicon the brand directory builds, as svg and as ico', () => {
    for (const file of ['favicon.svg', 'favicon.ico']) {
      const served = readFileSync(path.join(REPO_ROOT, 'packages/instrument/src', file));
      expect(served.equals(readFileSync(path.join(BRAND, file))), file).toBe(true);
    }
  });

  it('is linked from the console shell as the favicon, with the touch icon', () => {
    const html = readFileSync(path.join(REPO_ROOT, 'apps/admin-console/index.html'), 'utf8');
    for (const link of FAVICON_LINKS) expect(html).toContain(`${link} />`);
    expect(html).toContain('rel="apple-touch-icon" href="/instrument/apple-touch-icon.png"');
    expect(html).not.toContain('rel="icon" href="/instrument/mark.svg"');
  });

  it('is linked from every server page shell, through the kernel, as the same favicon', () => {
    const kernel = readFileSync(path.join(REPO_ROOT, 'packages/kernel/src/page.ts'), 'utf8');
    for (const link of FAVICON_LINKS) expect(kernel).toContain(`${link}>`);
    expect(kernel).not.toContain('rel="icon" href="/instrument/mark.svg"');
    for (const pkg of ['account', 'authn-flows', 'console-gateway', 'protocol-oidc']) {
      const renderer = readFileSync(
        path.join(REPO_ROOT, `packages/${pkg}/src/view/document.ts`),
        'utf8',
      );
      expect(renderer, pkg).toContain('${brandingHead(locale)}');
    }
  });

  it('is built into the instrument directory beside the touch icon', () => {
    const build = readFileSync(
      path.join(REPO_ROOT, 'packages/instrument/scripts/build.ts'),
      'utf8',
    );
    for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
      expect(build, file).toContain(`'${file}'`);
    }
  });

  it('is drawn by the console from the same three shapes as mark.svg', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'apps/admin-console/src/shared/view/BrandLine/BrandLine.tsx'),
      'utf8',
    );
    const own = parseMark(read('mark.svg'));
    const drawn = jsxMark(source);
    expect(drawn.circle).toEqual(own.ring);
    expect(drawn.paths).toEqual([
      `M${String(own.shaft.x)} ${String(own.shaft.from)}V${String(own.shaft.to)}`,
      `M${String(own.crossbar.from)} ${String(own.crossbar.y)}H${String(own.crossbar.to)}`,
    ]);
    expect(drawn.strokeWidth).toBe(own.strokeWidth);
    expect(drawn.linecap).toBe('round');
  });

  it('notices a console mark that has drifted, however the source is formatted', () => {
    const one =
      '<svg strokeWidth="2" strokeLinecap="round"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg>';
    const moved = one.replace('M12 14H20', 'M12 20H20');
    expect(jsxMark(`const x = (${one});`).paths[1]).toBe('M12 14H20');
    expect(
      jsxMark(
        `const x = (\n<svg strokeWidth="2" strokeLinecap="round">\n<circle\n cx="16" cy="6" r="4"\n />\n<path d="M16 10V30" />\n<path d="M12 14H20" />\n</svg>\n);`,
      ).paths,
    ).toEqual(['M16 10V30', 'M12 14H20']);
    expect(jsxMark(`const x = (${moved});`).paths[1]).toBe('M12 20H20');
    expect(jsxMark(`const x = (${one.replace('r="4"', 'r="5"')});`).circle?.r).toBe(5);
  });

  it('is proxied to the server by the console dev server, so the icons load there too', () => {
    const config = readFileSync(path.join(REPO_ROOT, 'apps/admin-console/vite.config.ts'), 'utf8');
    expect(config).toContain("'/instrument': upstream");
  });

  it('has every exported renderer return its markup through page()', () => {
    const renderers = globSync('packages/*/src/view/*-html.ts', { cwd: REPO_ROOT });
    expect(renderers.length).toBeGreaterThanOrEqual(15);
    for (const file of renderers) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(exportsWithoutPage(source), file).toEqual([]);
    }
  });

  it('would notice a renderer that builds its own document', () => {
    expect(
      exportsWithoutPage(
        'export function good() { return page({}); }\nexport function bad() { return `<!doctype html>`; }',
      ),
    ).toEqual(['bad']);
    expect(
      exportsWithoutPage(
        'export function send(reply: R, rendered: RenderedPage) { return reply.send(rendered.html); }\nfunction inner() { return page({}); }\nexport function viaInner() { return inner(); }\nexport const arrow = () => `<p>`;',
      ),
    ).toEqual(['arrow']);
  });
});

describe('the console names the product through its constants', () => {
  const withoutComments = (source: string): string =>
    source.replaceAll(/\/\/.*$/gmu, '').replaceAll(/\/\*[\s\S]*?\*\//gu, '');

  it.each([
    'apps/admin-console/src/shared/view/AppShell/AppShell.tsx',
    'apps/admin-console/src/features/session/view/SessionGate/SessionGate.tsx',
    'apps/admin-console/src/features/session/view/SessionStatus/SessionStatus.tsx',
  ])('has no product name typed in the markup of %s', (file) => {
    const source = withoutComments(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
    expect(source).not.toMatch(/['"`>]\s*odudu/iu);
  });

  it('would notice one', () => {
    expect(withoutComments('<p>Odudu console</p>')).toMatch(/['"`>]\s*odudu/iu);
    expect(withoutComments("brand = 'Odudu'")).toMatch(/['"`>]\s*odudu/iu);
    expect(withoutComments('// Odudu console\nbrand = PRODUCT_NAME')).not.toMatch(
      /['"`>]\s*odudu/iu,
    );
  });
});

describe('the copies the documentation site serves', () => {
  it('are the brand files byte for byte', () => {
    for (const file of [
      'favicon.svg',
      'favicon.ico',
      'apple-touch-icon.png',
      'social.png',
      'mark-ink.svg',
      'mark-paper.svg',
      'lockup.svg',
    ]) {
      const served = readFileSync(path.join(REPO_ROOT, 'apps/docs/static/brand', file));
      expect(served.equals(readFileSync(path.join(BRAND, file))), file).toBe(true);
    }
  });

  it('are the mark every page carries', () => {
    const instrument = readFileSync(
      path.join(REPO_ROOT, 'packages/instrument/src/mark.svg'),
      'utf8',
    );
    const own = parseMark(instrument);
    expect(own).toEqual(parseMark(read('mark.svg')));
    expect(instrument).toContain('stroke-linecap="round"');
    for (const pkg of ['account', 'authn-flows', 'console-gateway', 'protocol-oidc']) {
      const renderer = readFileSync(
        path.join(REPO_ROOT, `packages/${pkg}/src/view/document.ts`),
        'utf8',
      );
      for (const shape of [
        '<circle cx="16" cy="6" r="4"/>',
        '<path d="M16 10V30"/>',
        '<path d="M12 14H20"/>',
      ]) {
        expect(renderer, `${pkg} draws ${shape}`).toContain(shape);
      }
      expect(renderer, pkg).toContain('stroke-linecap="round"');
    }
  });
});
