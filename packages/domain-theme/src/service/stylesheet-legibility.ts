import valueParser from 'postcss-value-parser';
import { contrastRatio } from '#/service/contrast';

type ValueNode = ReturnType<typeof valueParser>['nodes'][number];

// Below this the text is, for a person, the background.
const INVISIBLE_RATIO = 1.5;

// The smallest text a tenant may set on a part the page needs, and the
// smallest box: a part collapsed to a sliver is hidden with extra steps.
const MIN_FONT_PX = 12;
const MIN_BOX_PX = 16;
const MIN_BOX_PERCENT = 10;
const MAX_SPACE_PX = 128;
const MAX_SPACE_PERCENT = 50;
// Text fainter than this is, for a person, not there.
const MIN_ALPHA = 0.5;
const MIN_LINE_HEIGHT = 0.8;
const EM_PX = 16;

const NAMED: Readonly<Record<string, string>> = {
  black: '000000',
  silver: 'c0c0c0',
  gray: '808080',
  grey: '808080',
  white: 'ffffff',
  maroon: '800000',
  red: 'ff0000',
  purple: '800080',
  fuchsia: 'ff00ff',
  green: '008000',
  lime: '00ff00',
  olive: '808000',
  yellow: 'ffff00',
  navy: '000080',
  blue: '0000ff',
  teal: '008080',
  aqua: '00ffff',
  orange: 'ffa500',
};

const BOX_PROPERTIES = new Set([
  'width',
  'max-width',
  'inline-size',
  'max-inline-size',
  'height',
  'max-height',
  'block-size',
  'max-block-size',
]);

const SMALL_KEYWORDS = new Set(['xx-small', 'x-small']);

export interface Colour {
  // Opaque colours as 6 hex digits, a token as `var:name`, else null.
  key: string | null;
  clear: boolean;
}

function parts(node: Extract<ValueNode, { type: 'function' }>): string[] {
  return node.nodes
    .filter((n) => n.type === 'word')
    .map((n) => n.value)
    .filter((v) => v !== '');
}

function channelValue(text: string, scale: number): number {
  const n = Number.parseFloat(text);
  const value = text.endsWith('%') ? (n / 100) * scale : n;
  return Math.max(0, Math.min(scale, value));
}

function alphaOf(text: string | undefined): number {
  if (text === undefined) return 1;
  return channelValue(text, 1);
}

function hsl(h: number, s: number, l: number): string {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
}

function fromFunction(node: Extract<ValueNode, { type: 'function' }>): Colour | null {
  const name = node.value.toLowerCase();
  const args = parts(node);
  if (name === 'var') return { key: `var:${args[0] ?? ''}`, clear: false };
  if (args.length < 3 || args.length > 4) return null;
  const alpha = alphaOf(args[3]);
  if (name === 'rgb' || name === 'rgba') {
    const hex = args
      .slice(0, 3)
      .map((a) => Math.round(channelValue(a, 255)).toString(16).padStart(2, '0'))
      .join('');
    return { key: hex, clear: alpha < MIN_ALPHA };
  }
  if (name === 'hsl' || name === 'hsla') {
    const h = ((Number.parseFloat(args[0] ?? '0') % 360) + 360) % 360 || 0;
    const key = hsl(h, channelValue(args[1] ?? '0', 1), channelValue(args[2] ?? '0', 1));
    return { key, clear: alpha < MIN_ALPHA };
  }
  return null;
}

function fromWord(word: string): Colour | null {
  const lower = word.toLowerCase();
  if (lower === 'transparent') return { key: null, clear: true };
  const named = NAMED[lower];
  if (named !== undefined) return { key: named, clear: false };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(lower)?.[1];
  if (hex === undefined) return null;
  const full = hex.length <= 4 ? hex.replace(/./g, (c) => c + c) : hex;
  const alpha = full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1;
  return { key: full.slice(0, 6), clear: alpha < MIN_ALPHA };
}

// The colour a value names, or null when it names none (a keyword such as
// currentcolor, a url, a length).
export function readColour(value: string): Colour | null {
  let found: Colour | null = null;
  for (const node of valueParser(value).nodes) {
    const colour =
      node.type === 'word'
        ? fromWord(node.value)
        : node.type === 'function'
          ? fromFunction(node)
          : null;
    if (colour !== null) found = colour;
  }
  return found;
}

export function isClear(value: string): boolean {
  return readColour(value)?.clear === true;
}

// Two colours a reader cannot tell apart. Tokens compare by name, since a
// scheme gives both the same colour.
export function sameColour(a: Colour, b: Colour): boolean {
  if (a.key === null || b.key === null) return false;
  if (a.key.startsWith('var:') || b.key.startsWith('var:')) return a.key === b.key;
  return contrastRatio(`#${a.key}`, `#${b.key}`) < INVISIBLE_RATIO;
}

function lengthPx(node: ValueNode): number | null {
  if (node.type !== 'word') return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|ch)?$/.exec(node.value.toLowerCase());
  if (m === null) return null;
  const n = Number(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * EM_PX : n;
}

// Why this value makes a needed part unreadable or gone, or null.
export function legibilityProblem(property: string, value: string): string | null {
  const nodes = valueParser(value).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (property === 'font-size' && only !== undefined) {
    if (only.type === 'word' && SMALL_KEYWORDS.has(only.value.toLowerCase())) {
      return 'text smaller than 12px';
    }
    const px = lengthPx(only);
    const percent = only.type === 'word' && only.value.endsWith('%');
    if (px !== null && px < (percent ? (MIN_FONT_PX / EM_PX) * 100 : MIN_FONT_PX)) {
      return 'text smaller than 12px';
    }
  }
  if (BOX_PROPERTIES.has(property) && only !== undefined) {
    const px = lengthPx(only);
    const percent = only.type === 'word' && only.value.endsWith('%');
    if (px !== null && px < (percent ? MIN_BOX_PERCENT : MIN_BOX_PX))
      return 'a box too small to read';
  }
  if (/^(?:margin|padding)/.test(property)) {
    for (const node of nodes) {
      const px = lengthPx(node);
      const percent = node.type === 'word' && node.value.endsWith('%');
      if (px !== null && px > (percent ? MAX_SPACE_PERCENT : MAX_SPACE_PX)) {
        return 'space that pushes the part off the page';
      }
    }
  }
  if (property === 'letter-spacing' && only !== undefined) {
    const raw = only.type === 'word' ? Number.parseFloat(only.value) : 0;
    if (raw < 0 && /(?:em|ch)$/i.test(only.value) && raw < -0.05)
      return 'letters drawn on one another';
    if (raw < 0 && /px$/i.test(only.value) && raw < -1) return 'letters drawn on one another';
  }
  if (property === 'line-height' && only?.type === 'word') {
    const n = Number.parseFloat(only.value);
    const unit = /[a-z%]+$/i.exec(only.value)?.[0];
    if (unit === undefined ? n < MIN_LINE_HEIGHT : (lengthPx(only) ?? EM_PX) < MIN_BOX_PX / 2) {
      return 'lines drawn on one another';
    }
  }
  if (property === 'color' && isClear(value)) return 'text with no colour';
  return null;
}

const OUTLINE_STYLES = new Set(['none', 'hidden']);

// An outline a tenant removes leaves a keyboard user without a place
// (WCAG 2.4.7). Refused on every rule, since an element's focus outline is
// the one a bare `button { outline: none }` removes too.
export function outlineProblem(property: string, value: string): string | null {
  if (!property.startsWith('outline') || property === 'outline-offset') return null;
  for (const node of valueParser(value).nodes) {
    if (node.type === 'word') {
      const word = node.value.toLowerCase();
      if (property !== 'outline-width' && property !== 'outline-color') {
        if (OUTLINE_STYLES.has(word)) return 'no focus outline';
      }
      const px = lengthPx(node);
      if (px !== null && px < 1 && property !== 'outline-color') return 'no focus outline';
    }
  }
  if (property !== 'outline-width' && property !== 'outline-style' && isClear(value)) {
    return 'a clear focus outline';
  }
  return null;
}

// `any` is a rule outside a dark media query: it may be drawn in either scheme.
export type Scheme = 'light' | 'dark' | 'any';

const SURFACES: Readonly<Record<'light' | 'dark', readonly string[]>> = {
  light: ['e7eae9', 'ffffff', 'f3f5f4'],
  dark: ['151a19', '1c2221', '121716'],
};
const SURFACE_TOKENS = new Set([
  'var:--surface-page',
  'var:--surface-panel',
  'var:--surface-sunken',
]);

// Whether a colour is the page, panel or sunken surface a part sits on, as
// the Instrument defaults draw it in this scheme or by token. A theme may
// choose its own surfaces; those are caught by the contrast pairs it declares.
export function isSurface(colour: Colour | null, scheme: Scheme): boolean {
  if (colour?.key === null || colour === null) return false;
  if (SURFACE_TOKENS.has(colour.key)) return true;
  const near = (list: readonly string[]): boolean =>
    list.some((surface) => sameColour(colour, { key: surface, clear: false }));
  if (scheme === 'dark') return near(SURFACES.dark);
  if (scheme === 'light') return near(SURFACES.light);
  // Near-black text is common in the light scheme, so the dark surfaces are
  // matched exactly there; the light ones, which text is rarely near, by sight.
  return near(SURFACES.light) || SURFACES.dark.includes(colour.key);
}

const CSS_WIDE = new Set(['initial', 'unset', 'inherit', 'revert', 'revert-layer']);
const MAX_OFFSET_PX = 16;

export function outlineValueProblem(
  property: string,
  value: string,
  scheme: Scheme,
): string | null {
  if (property === 'outline' || property === 'outline-style' || property === 'outline-width') {
    if (CSS_WIDE.has(value.trim().toLowerCase()))
      return 'a focus outline given back to the browser';
  }
  if (property === 'outline-offset') {
    const node = valueParser(value).nodes.find((n) => n.type === 'word');
    const px = node === undefined ? null : lengthPx(node);
    if (px !== null && px > MAX_OFFSET_PX) return 'an outline pushed away';
  }
  if (property === 'outline' || property === 'outline-color') {
    if (isSurface(readColour(value), scheme)) return 'an outline the colour of the page';
  }
  return null;
}
