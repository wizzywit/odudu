import {
  collector,
  isDigit,
  isLetter,
  isQuote,
  isWhitespace,
  scanWhile,
  type Collector,
  type CodeToken,
} from '#/shared/service/code/tokens';

type Block = 'rules' | 'declarations';

// At-rules whose block holds rules, not declarations.
const RULE_BLOCKS = new Set(['media', 'supports', 'layer', 'container', 'document']);

const CODE = {
  star: 0x2a,
  slash: 0x2f,
  backslash: 0x5c,
  dot: 0x2e,
  plus: 0x2b,
  minus: 0x2d,
  underscore: 0x5f,
  percent: 0x25,
  hash: 0x23,
  bang: 0x21,
  open: 0x7b,
  close: 0x7d,
  semicolon: 0x3b,
  colon: 0x3a,
  parenOpen: 0x28,
  parenClose: 0x29,
  at: 0x40,
  newline: 0x0a,
};

function isIdentifierStart(code: number): boolean {
  return (
    isLetter(code) ||
    code === CODE.minus ||
    code === CODE.underscore ||
    code === CODE.backslash ||
    code >= 0x80
  );
}

function isIdentifier(code: number): boolean {
  return isIdentifierStart(code) || isDigit(code);
}

function startsComment(source: string, at: number): boolean {
  return source.charCodeAt(at) === CODE.slash && source.charCodeAt(at + 1) === CODE.star;
}

function commentEnd(source: string, at: number): number {
  const end = source.indexOf('*/', at + 2);
  return end === -1 ? source.length : end + 2;
}

// A string ends at its quote, or at the line's end when it has none: CSS
// does not let a string run across lines.
function stringEnd(source: string, at: number): number {
  const quote = source.charCodeAt(at);
  let index = at + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === CODE.backslash) index += 2;
    else if (code === quote) return index + 1;
    else if (code === CODE.newline) return index;
    else index += 1;
  }
  return source.length;
}

function numberAt(source: string, at: number): boolean {
  const first = source.charCodeAt(at);
  const second = source.charCodeAt(at + 1);
  if (isDigit(first)) return true;
  if (first === CODE.dot) return isDigit(second);
  if (first !== CODE.plus && first !== CODE.minus) return false;
  return isDigit(second) || (second === CODE.dot && isDigit(source.charCodeAt(at + 2)));
}

// A number and its unit, or a percentage.
function numberEnd(source: string, at: number): number {
  let index = at + 1;
  index = scanWhile(source, index, isDigit);
  if (source.charCodeAt(index) === CODE.dot) index = scanWhile(source, index + 1, isDigit);
  index = scanWhile(source, index, (code) => isLetter(code) || code === CODE.percent);
  return index;
}

// url( with an unquoted address: the address is one string, to the bracket.
function unquotedUrl(out: Collector, source: string, at: number): number {
  const open = at;
  out.push('plain', open, open + 1);
  const start = scanWhile(source, open + 1, isWhitespace);
  out.push('plain', open + 1, start);
  if (isQuote(source.charCodeAt(start)) || start >= source.length) return start;
  let end = start;
  while (
    end < source.length &&
    source.charCodeAt(end) !== CODE.parenClose &&
    source.charCodeAt(end) !== CODE.newline
  ) {
    end += 1;
  }
  out.push('string', start, end);
  return end;
}

function identifierInValue(out: Collector, source: string, at: number): number {
  const end = scanWhile(source, at, isIdentifier);
  if (source.charCodeAt(end) !== CODE.parenOpen) {
    out.push('value', at, end);
    return end;
  }
  out.push('function', at, end);
  if (source.slice(at, end).toLowerCase() === 'url') return unquotedUrl(out, source, end);
  return end;
}

// One piece of a value or of an at-rule's condition, from `at`; always
// moves on.
function valuePiece(out: Collector, source: string, at: number): number {
  const code = source.charCodeAt(at);
  if (isWhitespace(code)) {
    const end = scanWhile(source, at, isWhitespace);
    out.push('plain', at, end);
    return end;
  }
  if (startsComment(source, at)) {
    const end = commentEnd(source, at);
    out.push('comment', at, end);
    return end;
  }
  if (isQuote(code)) {
    const end = stringEnd(source, at);
    out.push('string', at, end);
    return end;
  }
  if (numberAt(source, at)) {
    const end = numberEnd(source, at);
    out.push('number', at, end);
    return end;
  }
  if (code === CODE.hash) {
    const end = scanWhile(source, at + 1, isIdentifier);
    out.push('number', at, end);
    return end;
  }
  if (code === CODE.bang) {
    const end = scanWhile(source, scanWhile(source, at + 1, isWhitespace), isLetter);
    out.push('keyword', at, end);
    return end;
  }
  if (isIdentifierStart(code)) return identifierInValue(out, source, at);
  out.push('plain', at, at + 1);
  return at + 1;
}

function isStop(code: number): boolean {
  return code === CODE.semicolon || code === CODE.close || code === CODE.open;
}

function valueRun(out: Collector, source: string, from: number): number {
  let index = from;
  while (index < source.length && !isStop(source.charCodeAt(index))) {
    index = valuePiece(out, source, index);
  }
  return index;
}

function selectorRun(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (isStop(code) || isQuote(code) || startsComment(source, index)) break;
    index += 1;
  }
  return index;
}

function atRule(out: Collector, source: string, at: number, stack: Block[]): number {
  const nameEnd = scanWhile(source, at + 1, isIdentifier);
  out.push('keyword', at, nameEnd);
  const end = valueRun(out, source, nameEnd);
  const code = source.charCodeAt(end);
  if (code !== CODE.open && code !== CODE.semicolon) return end;
  out.push('plain', end, end + 1);
  if (code === CODE.open) {
    const name = source.slice(at + 1, nameEnd).toLowerCase();
    stack.push(RULE_BLOCKS.has(name) ? 'rules' : 'declarations');
  }
  return end + 1;
}

// What every context shares: space, comments, braces and semicolons. Returns
// the next position when `at` was one of them.
function common(out: Collector, source: string, at: number, stack: Block[]): number | null {
  const code = source.charCodeAt(at);
  if (isWhitespace(code)) {
    const end = scanWhile(source, at, isWhitespace);
    out.push('plain', at, end);
    return end;
  }
  if (startsComment(source, at)) {
    const end = commentEnd(source, at);
    out.push('comment', at, end);
    return end;
  }
  if (code === CODE.close) {
    stack.pop();
    out.push('plain', at, at + 1);
    return at + 1;
  }
  if (code === CODE.open) {
    stack.push('declarations');
    out.push('plain', at, at + 1);
    return at + 1;
  }
  if (code === CODE.semicolon) {
    out.push('plain', at, at + 1);
    return at + 1;
  }
  return null;
}

function rulePart(out: Collector, source: string, at: number, stack: Block[]): number {
  const code = source.charCodeAt(at);
  if (code === CODE.at) return atRule(out, source, at, stack);
  if (isQuote(code)) {
    const end = stringEnd(source, at);
    out.push('string', at, end);
    return end;
  }
  const end = selectorRun(source, at);
  out.push('selector', at, Math.max(end, at + 1));
  return Math.max(end, at + 1);
}

function declarationPart(out: Collector, source: string, at: number): number {
  const code = source.charCodeAt(at);
  if (isQuote(code)) {
    const end = stringEnd(source, at);
    out.push('string', at, end);
    return end;
  }
  const end = scanWhile(
    source,
    at,
    (c) => !isWhitespace(c) && c !== CODE.colon && !isStop(c) && !isQuote(c) && c !== CODE.slash,
  );
  out.push('property', at, Math.max(end, at + 1));
  const next = Math.max(end, at + 1);
  const gap = scanWhile(source, next, isWhitespace);
  if (source.charCodeAt(gap) !== CODE.colon) return next;
  out.push('plain', next, gap + 1);
  return valueRun(out, source, gap + 1);
}

// Colours a stylesheet. One pass, left to right: each step moves on at
// least one character, so the cost is linear in the text however it is
// broken (an unterminated string or comment runs to its end and is read
// once). The rules are the CSS the server's checks read, not all of CSS.
export function cssTokens(source: string): CodeToken[] {
  const out = collector(source);
  const stack: Block[] = [];
  let at = 0;
  while (at < source.length) {
    const shared = common(out, source, at, stack);
    if (shared !== null) {
      at = shared;
    } else if (stack[stack.length - 1] === 'declarations') {
      at = declarationPart(out, source, at);
    } else {
      at = rulePart(out, source, at, stack);
    }
  }
  return out.tokens();
}
