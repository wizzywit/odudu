import {
  collector,
  isLetter,
  isQuote,
  isWhitespace,
  scanUntil,
  scanWhile,
  type Collector,
  type CodeToken,
} from '#/shared/service/code/tokens';

// A marker is {{part}} or {{t "key"}}; one that does not close within this
// many characters, or on its line, is not read as a marker.
export const MARKER_LIMIT = 120;

const LESS = 0x3c;
const GREATER = 0x3e;
const SLASH = 0x2f;
const EQUALS = 0x3d;
const OPEN = 0x7b;
const CLOSE = 0x7d;
const NEWLINE = 0x0a;

function isMarkerStart(source: string, at: number): boolean {
  return source.charCodeAt(at) === OPEN && source.charCodeAt(at + 1) === OPEN;
}

// The end of the marker opening at `at`, or -1.
function markerEnd(source: string, at: number): number {
  const stop = Math.min(source.length - 1, at + MARKER_LIMIT);
  for (let index = at + 2; index < stop; index += 1) {
    const code = source.charCodeAt(index);
    if (code === NEWLINE) return -1;
    if (code === CLOSE && source.charCodeAt(index + 1) === CLOSE) return index + 2;
  }
  return -1;
}

function startsTag(source: string, at: number): boolean {
  if (source.charCodeAt(at) !== LESS) return false;
  const next = source.charCodeAt(at + 1);
  return isLetter(next) || (next === SLASH && isLetter(source.charCodeAt(at + 2)));
}

function quotedEnd(source: string, at: number): number {
  const end = source.indexOf(source[at] ?? '"', at + 1);
  return end === -1 ? source.length : end + 1;
}

function isNameEnd(code: number): boolean {
  return isWhitespace(code) || code === GREATER || code === SLASH || code === EQUALS;
}

interface Step {
  next: number;
  // The tag is over, closed or broken off.
  done: boolean;
  // An `=` was just read, so an unquoted word is the value.
  valued: boolean;
}

function step(next: number, valued = false, done = false): Step {
  return { next, valued, done };
}

function isValueEnd(code: number): boolean {
  return isWhitespace(code) || code === GREATER;
}

// What a tag holds after its name: attributes, their values, and the close.
function insideTag(out: Collector, source: string, at: number, valued: boolean): Step {
  const code = source.charCodeAt(at);
  if (isWhitespace(code)) {
    const end = scanWhile(source, at, isWhitespace);
    out.push('plain', at, end);
    return step(end, valued);
  }
  if (code === GREATER || (code === SLASH && source.charCodeAt(at + 1) === GREATER)) {
    const end = code === GREATER ? at + 1 : at + 2;
    out.push('tag', at, end);
    return step(end, false, true);
  }
  if (code === LESS) return step(at, false, true);
  const marker = isMarkerStart(source, at) ? markerEnd(source, at) : -1;
  if (marker !== -1) {
    out.push('part', at, marker);
    return step(marker);
  }
  if (isQuote(code)) {
    const end = quotedEnd(source, at);
    out.push('string', at, end);
    return step(end);
  }
  if (code === EQUALS || code === SLASH) {
    out.push('plain', at, at + 1);
    return step(at + 1, code === EQUALS);
  }
  const end = Math.max(scanUntil(source, at + 1, valued ? isValueEnd : isNameEnd), at + 1);
  out.push(valued ? 'string' : 'attribute', at, end);
  return step(end);
}

// Colours the tag opening at `at`; the position after it, so a tag that is
// broken off by another `<` hands the rest back as text.
function tag(out: Collector, source: string, at: number): number {
  const nameFrom = source.charCodeAt(at + 1) === SLASH ? at + 2 : at + 1;
  let index = scanUntil(source, nameFrom, isNameEnd);
  out.push('tag', at, index);
  let valued = false;
  while (index < source.length) {
    const read = insideTag(out, source, index, valued);
    index = read.next;
    valued = read.valued;
    if (read.done) return index;
  }
  return source.length;
}

function textEnd(source: string, at: number): number {
  return scanUntil(
    source,
    at + 1,
    (code, index) => code === LESS || (code === OPEN && isMarkerStart(source, index)),
  );
}

function piece(out: Collector, source: string, at: number): number {
  if (isMarkerStart(source, at)) {
    const end = markerEnd(source, at);
    if (end !== -1) {
      out.push('part', at, end);
      return end;
    }
  }
  if (source.startsWith('<!--', at)) {
    const close = source.indexOf('-->', at + 4);
    const end = close === -1 ? source.length : close + 3;
    out.push('comment', at, end);
    return end;
  }
  if (startsTag(source, at)) return tag(out, source, at);
  const end = textEnd(source, at);
  out.push('plain', at, end);
  return end;
}

// Colours a page template: HTML tags, attributes and comments, and the
// {{part}} and {{t "key"}} markers the server fills in. One pass, each step
// moving on, so the cost is linear in the text however it is broken.
export function templateTokens(source: string): CodeToken[] {
  const out = collector(source);
  let at = 0;
  while (at < source.length) at = piece(out, source, at);
  return out.tokens();
}
