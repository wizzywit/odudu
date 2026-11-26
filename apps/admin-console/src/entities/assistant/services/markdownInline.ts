import type { Budget, SafeNode } from '#/entities/assistant/types/safeNode';

const MAX_DEPTH = 4;
// A paragraph longer than this is shown as it is: finding the end of each
// emphasis run in it would cost the square of its length.
const INLINE_MAX_CHARS = 4_000;
const DESTINATION_MAX_CHARS = 2_048;
const CONSOLE_PATH = /^\/console\/[A-Za-z0-9._~/-]*$/u;
const EXTERNAL = /^https?:\/\/[!-~]+$/iu;

export function spend(budget: Budget): boolean {
  budget.left -= 1;
  return budget.left >= 0;
}

function plain(nodes: readonly SafeNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text' || node.kind === 'code') out += node.text;
    else if ('children' in node) out += plain(node.children);
  }
  return out;
}

function pushText(nodes: SafeNode[], text: string, budget: Budget): void {
  if (text === '') return;
  const last = nodes[nodes.length - 1];
  if (last?.kind === 'text') {
    last.text += text;
    return;
  }
  if (spend(budget)) nodes.push({ kind: 'text', text });
}

interface Destination {
  label: string;
  target: string;
  end: number;
}

// The `)` that closes a destination, counting the pairs inside it.
function closingParen(source: string, from: number): number {
  let depth = 1;
  const stop = Math.min(source.length, from + DESTINATION_MAX_CHARS);
  for (let at = from; at < stop; at += 1) {
    const char = source[at];
    if (char === '\\') at += 1;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

// `[label](target)` starting at the `[` at `from`, or null.
function bracketed(source: string, from: number): Destination | null {
  let depth = 0;
  let at = from;
  for (; at < source.length && at - from < INLINE_MAX_CHARS; at += 1) {
    const char = source[at];
    if (char === '\\') at += 1;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || source[at + 1] !== '(') return null;
  const close = closingParen(source, at + 2);
  if (close === -1) return null;
  const inner = source.slice(at + 2, close).trim();
  // A title after the address is allowed; anything else after a space is not.
  const space = inner.search(/\s/u);
  const titled = space === -1 || /^["']/u.test(inner.slice(space).trim());
  const target = titled ? inner.slice(0, space === -1 ? undefined : space) : '';
  return { label: source.slice(from + 1, at), target, end: close + 1 };
}

function linkNodes(found: Destination, nodes: SafeNode[], budget: Budget): void {
  const { label, target } = found;
  // Anything that is not plain ASCII, or that hid a character the browser
  // would skip, is not an address worth showing, let alone following.
  if (CONSOLE_PATH.test(target) && !target.includes('..')) {
    if (spend(budget)) {
      nodes.push({ kind: 'link', href: target, children: [{ kind: 'text', text: label }] });
    }
    return;
  }
  pushText(nodes, label, budget);
  if (EXTERNAL.test(target) && !target.includes('\\')) pushText(nodes, ` (${target})`, budget);
}

function closer(source: string, delimiter: string, from: number): number {
  const stop = Math.min(source.length, from + INLINE_MAX_CHARS);
  for (let at = source.indexOf(delimiter, from); at !== -1 && at < stop;) {
    const before = source[at - 1] ?? '';
    if (at > from && !/\s/u.test(before)) return at;
    at = source.indexOf(delimiter, at + 1);
  }
  return -1;
}

function emphasis(
  source: string,
  at: number,
  depth: number,
  budget: Budget,
): { node: SafeNode; end: number } | null {
  const char = source[at] ?? '';
  const delimiter = source.startsWith(char + char, at) ? char + char : char;
  const start = at + delimiter.length;
  const next = source[start] ?? '';
  const prior = source[at - 1] ?? ' ';
  const wordInner = char === '_' && /[\p{L}\p{N}]/u.test(prior);
  if (depth >= MAX_DEPTH || next === '' || /\s/u.test(next) || wordInner) return null;
  const end = closer(source, delimiter, start);
  if (end === -1 || end === start) return null;
  if (!spend(budget)) return null;
  return {
    node: {
      kind: delimiter.length === 2 ? 'strong' : 'em',
      children: inline(source.slice(start, end), depth + 1, budget),
    },
    end: end + delimiter.length,
  };
}

function codeSpan(source: string, at: number): { text: string; end: number } | null {
  let run = 0;
  while (source[at + run] === '`') run += 1;
  const fence = '`'.repeat(run);
  const end = source.indexOf(fence, at + run);
  if (end === -1 || end - at > INLINE_MAX_CHARS) return null;
  return { text: source.slice(at + run, end).trim(), end: end + run };
}

// One line of text as nodes: emphasis, code, links and plain text.
export function inline(source: string, depth: number, budget: Budget): SafeNode[] {
  const nodes: SafeNode[] = [];
  if (source.length > INLINE_MAX_CHARS) {
    pushText(nodes, source, budget);
    return nodes;
  }
  let at = 0;
  let run = '';
  const flush = (): void => {
    pushText(nodes, run, budget);
    run = '';
  };
  while (at < source.length && budget.left > 0) {
    const char = source[at] ?? '';
    if (char === '\\' && /[\\`*_[\]()#+\-.!<>]/u.test(source[at + 1] ?? '')) {
      run += source[at + 1] ?? '';
      at += 2;
      continue;
    }
    if (char === '`') {
      const code = codeSpan(source, at);
      if (code !== null) {
        flush();
        if (spend(budget)) nodes.push({ kind: 'code', text: code.text });
        at = code.end;
        continue;
      }
    }
    if (char === '[' || (char === '!' && source[at + 1] === '[')) {
      const image = char === '!';
      const found = bracketed(source, image ? at + 1 : at);
      if (found !== null) {
        flush();
        const label = plain(inline(found.label, depth + 1, budget));
        if (image) pushText(nodes, label, budget);
        else linkNodes({ ...found, label }, nodes, budget);
        at = found.end;
        continue;
      }
    }
    if (char === '*' || char === '_') {
      const made = emphasis(source, at, depth, budget);
      if (made !== null) {
        flush();
        nodes.push(made.node);
        at = made.end;
        continue;
      }
    }
    run += char;
    at += 1;
  }
  flush();
  return nodes;
}
