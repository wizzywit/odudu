import { inline, spend } from '#/entities/assistant/services/markdownInline';
import { cleanText } from '#/entities/assistant/services/textClean';
import { ASSISTANT_WORDING } from '#/entities/assistant/services/wording';
import type { Budget, SafeNode } from '#/entities/assistant/types/safeNode';

export type { SafeNode };

// Model output and the tenant text it quotes are rendered through this and
// nothing else: the result holds only the element kinds below, so a view that
// maps them one to one has no way to draw an image, a script, an address a
// click could leave the console by, or markup the text itself carried.
export const SAFE_NODE_KINDS = [
  'text',
  'strong',
  'em',
  'code',
  'pre',
  'br',
  'p',
  'ul',
  'ol',
  'li',
  'link',
] as const;

export const MARKDOWN_MAX_CHARS = 64_000;
const MAX_NODES = 5_000;
const BLANK = /^\s*$/u;
const FENCE = /^ {0,3}```/u;
const HEADING = /^ {0,3}#{1,6} +(.*)$/u;
const ITEM = /^ {0,3}([-*+]|\d{1,9}[.)]) +(.*)$/u;
const QUOTE = /^ {0,3}> ?(.*)$/u;

function lines(text: string, budget: Budget): SafeNode[] {
  const nodes: SafeNode[] = [];
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (index > 0 && spend(budget)) nodes.push({ kind: 'br' });
    nodes.push(...inline(part, 0, budget));
  });
  return nodes;
}

function paragraph(text: string, budget: Budget): SafeNode | null {
  if (!spend(budget)) return null;
  return { kind: 'p', children: lines(text, budget) };
}

interface Cursor {
  rows: readonly string[];
  at: number;
}

function fenced(cursor: Cursor, budget: Budget): SafeNode | null {
  const body: string[] = [];
  cursor.at += 1;
  while (cursor.at < cursor.rows.length && !FENCE.test(cursor.rows[cursor.at] ?? '')) {
    body.push(cursor.rows[cursor.at] ?? '');
    cursor.at += 1;
  }
  cursor.at += 1;
  return spend(budget) ? { kind: 'pre', text: body.join('\n') } : null;
}

function list(cursor: Cursor, budget: Budget): SafeNode | null {
  const ordered = /^\d/u.test(ITEM.exec(cursor.rows[cursor.at] ?? '')?.[1] ?? '');
  const items: SafeNode[] = [];
  for (let found = ITEM.exec(cursor.rows[cursor.at] ?? ''); found !== null;) {
    if (/^\d/u.test(found[1] ?? '') !== ordered || !spend(budget)) break;
    items.push({ kind: 'li', children: inline(found[2] ?? '', 0, budget) });
    cursor.at += 1;
    found = ITEM.exec(cursor.rows[cursor.at] ?? '');
  }
  return spend(budget) ? { kind: ordered ? 'ol' : 'ul', children: items } : null;
}

function heading(text: string, budget: Budget): SafeNode | null {
  if (!spend(budget)) return null;
  return { kind: 'p', children: [{ kind: 'strong', children: inline(text, 1, budget) }] };
}

function blocks(text: string, budget: Budget): SafeNode[] {
  const out: SafeNode[] = [];
  const cursor: Cursor = { rows: text.split('\n'), at: 0 };
  let pending: string[] = [];
  const push = (node: SafeNode | null): void => {
    if (node !== null) out.push(node);
  };
  const flush = (): void => {
    if (pending.length > 0) push(paragraph(pending.join('\n'), budget));
    pending = [];
  };
  while (cursor.at < cursor.rows.length && budget.left > 0) {
    const row = cursor.rows[cursor.at] ?? '';
    const title = HEADING.exec(row);
    if (FENCE.test(row) || ITEM.test(row)) {
      flush();
      push(FENCE.test(row) ? fenced(cursor, budget) : list(cursor, budget));
      continue;
    }
    if (title !== null) {
      flush();
      push(heading(title[1] ?? '', budget));
    } else if (BLANK.test(row)) flush();
    else pending.push(QUOTE.exec(row)?.[1] ?? row);
    cursor.at += 1;
  }
  flush();
  return out;
}

// The tree a view draws, from text the model wrote.
export function renderSafeMarkdown(text: string): SafeNode[] {
  const budget: Budget = { left: MAX_NODES };
  const nodes = blocks(cleanText(text.slice(0, MARKDOWN_MAX_CHARS)), budget);
  if (text.length > MARKDOWN_MAX_CHARS) {
    nodes.push({
      kind: 'p',
      children: [{ kind: 'text', text: ASSISTANT_WORDING.tooLongToShow }],
    });
  }
  return nodes;
}
