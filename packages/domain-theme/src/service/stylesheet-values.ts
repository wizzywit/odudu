import valueParser from 'postcss-value-parser';
import { CSS_TOKENS } from '#/service/hooks';
import type { StylesheetIssueCode } from '#/service/stylesheet-types';

const set = (words: string): ReadonlySet<string> => new Set(words.split(' '));

const TOKENS: ReadonlySet<string> = new Set(CSS_TOKENS);
const MAX_FUNCTION_DEPTH = 4;

const COLOURS = set(
  'black silver gray grey white maroon red purple fuchsia green lime olive yellow navy blue teal aqua orange transparent currentcolor inherit initial unset',
);
const KEYWORDS = set(
  [
    'none auto normal bold bolder lighter italic oblique solid dashed dotted double groove ridge',
    'inset outset hidden left right center start end justify top bottom uppercase lowercase',
    'capitalize underline overline line-through nowrap pre pre-wrap pre-line break-all keep-all',
    'break-word disc circle square decimal inside outside flex-start flex-end space-between',
    'space-around space-evenly stretch baseline row column wrap wrap-reverse row-reverse',
    'column-reverse cover contain fill scale-down no-repeat repeat repeat-x repeat-y medium thin',
    'thick min-content max-content fit-content xx-small x-small small large x-large xx-large',
    'smaller larger inline-flex',
  ].join(' '),
);
const DISPLAY = set('block inline inline-block flex grid none');
const POSITION = set('static relative');
const OVERFLOW = set('visible hidden auto');
const CURSOR = set('auto default pointer text not-allowed help wait progress');
const FONT_FAMILY_NAMES: ReadonlySet<string> = new Set([
  'ibm plex sans',
  'ibm plex mono',
  'system-ui',
  'sans-serif',
  'monospace',
  'serif',
]);

// Units are a fixed list with no viewport units; a negative length is
// refused everywhere but letter-spacing, so a tenant cannot pull a control
// off the page with a negative margin.
const NUMBER = /^([+-]?)(\d+\.?\d*|\.\d+)(px|em|rem|%|ch|fr|deg)?$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const COLOUR_FUNCTIONS = set('rgb rgba hsl hsla');
const URL_LIKE = set('url image-set -webkit-image-set src image cross-fade element paint');
const URL_PROPERTIES = set('background background-image');

function decodeEscapes(text: string): string {
  return text.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\r\n\f]?|([^\n]))/g,
    (_all, hex?: string, char?: string) => {
      if (char !== undefined) return char;
      const code = Number.parseInt(hex ?? '0', 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    },
  );
}

type ValueNode = ReturnType<typeof valueParser>['nodes'][number];

interface ValueContext {
  property: string;
  isAssetUrl: ((url: string) => boolean) | undefined;
  refuse: (code: StylesheetIssueCode, detail: string) => void;
}

function meaningful(nodes: ValueNode[]): ValueNode[] {
  return nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
}

function checkUrl(node: Extract<ValueNode, { type: 'function' }>, ctx: ValueContext): void {
  const parts = meaningful(node.nodes);
  const only = parts.length === 1 ? parts[0] : undefined;
  const arg =
    only !== undefined && (only.type === 'string' || only.type === 'word')
      ? only.value
      : valueParser.stringify(node.nodes).trim();
  const fine =
    decodeEscapes(node.value).toLowerCase() === 'url' &&
    URL_PROPERTIES.has(ctx.property) &&
    !arg.includes('\\') &&
    ctx.isAssetUrl?.(arg) === true;
  if (!fine) ctx.refuse('url-not-allowed', 'url()');
}

function checkWord(word: string, ctx: ValueContext, inColourFunction: boolean): void {
  const lower = word.toLowerCase();
  const number = NUMBER.exec(lower);
  if (number !== null) {
    const unitOk = number[3] !== 'deg' || inColourFunction;
    const signOk = number[1] !== '-' || ctx.property === 'letter-spacing';
    if (unitOk && signOk) return;
  } else if (HEX.test(lower) || COLOURS.has(lower) || KEYWORDS.has(lower)) {
    return;
  }
  ctx.refuse('value-not-allowed', word);
}

function checkNodes(
  nodes: ValueNode[],
  ctx: ValueContext,
  depth: number,
  inColourFunction: boolean,
): void {
  for (const node of nodes) {
    if (node.type === 'space' || node.type === 'comment') continue;
    if (node.type === 'div') {
      if (node.value !== ',' && node.value !== '/') ctx.refuse('value-not-allowed', node.value);
    } else if (node.type === 'word') {
      checkWord(node.value, ctx, inColourFunction);
    } else if (node.type === 'function') {
      checkFunction(node, ctx, depth);
    } else {
      ctx.refuse('value-not-allowed', node.type);
    }
  }
}

function checkFunction(
  node: Extract<ValueNode, { type: 'function' }>,
  ctx: ValueContext,
  depth: number,
): void {
  const name = decodeEscapes(node.value).toLowerCase();
  if (node.unclosed === true || depth >= MAX_FUNCTION_DEPTH) {
    ctx.refuse('value-not-allowed', `${name}(`);
  } else if (URL_LIKE.has(name)) {
    checkUrl(node, ctx);
  } else if (node.value.includes('\\')) {
    ctx.refuse('value-not-allowed', 'escape in a function name');
  } else if (name === 'var') {
    const only = node.nodes.length === 1 ? node.nodes[0] : undefined;
    if (only?.type !== 'word' || !TOKENS.has(only.value)) {
      ctx.refuse('value-not-allowed', 'var()');
    }
  } else if (COLOUR_FUNCTIONS.has(name)) {
    checkNodes(node.nodes, ctx, depth + 1, true);
  } else {
    ctx.refuse('value-not-allowed', `${name}()`);
  }
}

// Properties with their own grammar. Anything else is checked as a list of
// lengths, colours and keywords.
type Special = (nodes: ValueNode[], ctx: ValueContext) => void;

const oneOf =
  (allowed: ReadonlySet<string>): Special =>
  (nodes, ctx) => {
    const parts = meaningful(nodes);
    const only = parts[0];
    const word = only?.type === 'word' ? only.value.toLowerCase() : '';
    if (parts.length !== 1 || !allowed.has(word)) {
      ctx.refuse('value-not-allowed', valueParser.stringify(nodes));
    }
  };

const fontFamily: Special = (nodes, ctx) => {
  const names: string[] = [''];
  for (const node of meaningful(nodes)) {
    if (node.type === 'div' && node.value === ',') names.push('');
    else if (node.type === 'word' || (node.type === 'string' && node.unclosed !== true)) {
      names[names.length - 1] = `${names[names.length - 1] ?? ''} ${node.value}`
        .trim()
        .toLowerCase();
    } else {
      ctx.refuse('value-not-allowed', node.type);
      return;
    }
  }
  for (const name of names) {
    if (!FONT_FAMILY_NAMES.has(name)) ctx.refuse('value-not-allowed', name);
  }
};

const content: Special = (nodes, ctx) => {
  const parts = meaningful(nodes);
  const only = parts[0];
  const ok =
    parts.length === 1 &&
    only !== undefined &&
    ((only.type === 'word' && only.value.toLowerCase() === 'none') ||
      (only.type === 'string' && only.value === '' && only.unclosed !== true));
  if (!ok) ctx.refuse('value-not-allowed', 'content');
};

// A control a tenant can make invisible is as good as removed, so opacity
// has a floor.
const opacity: Special = (nodes, ctx) => {
  const parts = meaningful(nodes);
  const only = parts[0];
  const n =
    only?.type === 'word' && /^(?:\d+\.?\d*|\.\d+)$/.test(only.value) ? Number(only.value) : NaN;
  if (parts.length !== 1 || !(n >= 0.3 && n <= 1)) ctx.refuse('value-not-allowed', 'opacity');
};

const generic: Special = (nodes, ctx) => {
  checkNodes(nodes, ctx, 0, false);
};

const SPECIAL: Readonly<Record<string, Special>> = {
  display: oneOf(DISPLAY),
  position: oneOf(POSITION),
  overflow: oneOf(OVERFLOW),
  cursor: oneOf(CURSOR),
  'font-family': fontFamily,
  content,
  opacity,
};

export type RefuseValue = (code: StylesheetIssueCode, detail: string) => void;

export function checkValue(
  property: string,
  value: string,
  isAssetUrl: ((url: string) => boolean) | undefined,
  refuse: RefuseValue,
): void {
  const ctx: ValueContext = { property, isAssetUrl, refuse };
  if (value.trim() === '') refuse('value-not-allowed', 'empty');
  else (SPECIAL[property] ?? generic)(valueParser(value).nodes, ctx);
}
