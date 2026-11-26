const OMITTED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg']);

// Controls other than tab and newline, the bidirectional overrides and
// isolates that reorder what a person reads, and zero-width characters.
function invisible(code: number): boolean {
  return (
    (code < 32 && code !== 9 && code !== 10) ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function visibleOnly(text: string): string {
  let out = '';
  for (let at = 0; at < text.length; at += 1) {
    if (!invisible(text.charCodeAt(at))) out += text.charAt(at);
  }
  return out;
}

function lowerLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// Raw markup is removed, never escaped back into view: a tag is the text
// from `<` to the next `>` when it starts like one, and an element that can
// run or load something takes its content with it.
function stripOnce(source: string): string {
  let out = '';
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    if (open === -1) return out + source.slice(at);
    out += source.slice(at, open);
    const first = source.charCodeAt(open + 1);
    const tagLike = lowerLetter(first) || first === 47 || first === 33;
    const close = tagLike ? source.indexOf('>', open) : -1;
    if (close === -1) {
      // A tag that never ends is dropped as a browser would drop it; a bare
      // less-than sign is text.
      out += tagLike ? '' : '<';
      at = open + 1;
      continue;
    }
    const name = /^<\/?([A-Za-z][A-Za-z0-9]*)/u.exec(source.slice(open, open + 40))?.[1];
    at = close + 1;
    if (name !== undefined && source[open + 1] !== '/' && OMITTED.has(name.toLowerCase())) {
      const end = source.toLowerCase().indexOf(`</${name.toLowerCase()}`, at);
      if (end === -1) return out;
      const after = source.indexOf('>', end);
      if (after === -1) return out;
      at = after + 1;
    }
  }
  return out;
}

// Removing a tag can join the two characters either side of it into a new
// one, so the pass repeats until it changes nothing.
function stripMarkup(source: string): string {
  let current = source;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = stripOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

// The text with no raw markup and no character that hides or reorders others.
export function cleanText(text: string): string {
  return stripMarkup(visibleOnly(text));
}
