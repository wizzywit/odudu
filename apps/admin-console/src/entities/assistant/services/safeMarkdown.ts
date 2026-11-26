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
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
] as const;

export const MARKDOWN_MAX_CHARS = 64_000;
const MAX_NODES = 5_000;
const BLANK = /^\s*$/u;
const FENCE = /^ {0,3}```/u;
const HEADING = /^ {0,3}#{1,6} +(.*)$/u;
const ITEM = /^ {0,3}([-*+]|\d{1,9}[.)]) +(.*)$/u;
const SEPARATOR = /^ {0,3}\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/u;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 100;
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

// The cells of one table row: split at each bar the text did not escape, the
// bars at either end belonging to the row and not to a cell.
function splitRow(row: string): string[] {
  const text = row.trim();
  const cells: string[] = [];
  let cell = '';
  for (let at = text.startsWith('|') ? 1 : 0; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (char === '\\' && text[at + 1] === '|') {
      cell += '|';
      at += 1;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  if (cell.trim() !== '' || !text.endsWith('|')) cells.push(cell.trim());
  return cells;
}

function startsTable(cursor: Cursor): boolean {
  const head = cursor.rows[cursor.at] ?? '';
  const rule = cursor.rows[cursor.at + 1] ?? '';
  if (!head.includes('|') || !SEPARATOR.test(rule)) return false;
  const columns = splitRow(head).length;
  return columns > 0 && columns === splitRow(rule).length;
}

function tableRow(cells: readonly string[], kind: 'th' | 'td', budget: Budget): SafeNode | null {
  if (!spend(budget)) return null;
  const children: SafeNode[] = [];
  for (const cell of cells) {
    if (!spend(budget)) break;
    children.push({ kind, children: inline(cell, 0, budget) });
  }
  return { kind: 'tr', children };
}

// A header row, its separator row and the rows that follow, as a table. A row
// with more cells than the header is cut to it and a short one is padded, so
// every row has the header's width, itself cut to a fixed number of columns.
function table(cursor: Cursor, budget: Budget): SafeNode[] {
  const header = splitRow(cursor.rows[cursor.at] ?? '').slice(0, MAX_TABLE_COLUMNS);
  const width = header.length;
  cursor.at += 2;
  const top = tableRow(header, 'th', budget);
  const body: SafeNode[] = [];
  let cut = false;
  while (cursor.at < cursor.rows.length) {
    const row = cursor.rows[cursor.at] ?? '';
    if (BLANK.test(row) || !row.includes('|') || FENCE.test(row) || HEADING.test(row)) break;
    cursor.at += 1;
    if (body.length >= MAX_TABLE_ROWS) {
      cut = true;
      continue;
    }
    const cells = splitRow(row).slice(0, width);
    while (cells.length < width) cells.push('');
    const made = tableRow(cells, 'td', budget);
    if (made !== null) body.push(made);
  }
  const out: SafeNode[] = [];
  if (top !== null && spend(budget) && spend(budget) && spend(budget)) {
    out.push({
      kind: 'table',
      children: [
        { kind: 'thead', children: [top] },
        { kind: 'tbody', children: body },
      ],
    });
  }
  if (cut && spend(budget)) {
    out.push({ kind: 'p', children: [{ kind: 'text', text: ASSISTANT_WORDING.rowsNotShown }] });
  }
  return out;
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
    if (startsTable(cursor)) {
      flush();
      out.push(...table(cursor, budget));
      continue;
    }
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
