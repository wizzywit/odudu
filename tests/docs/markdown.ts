import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export interface Document {
  readonly name: string;
  readonly lines: readonly string[];
}

export function loadDocument(relativePath: string): Document {
  return {
    name: relativePath,
    lines: readFileSync(path.join(REPO_ROOT, relativePath), 'utf8').split('\n'),
  };
}

// Every extractor below throws rather than returning nothing. A check that
// silently finds no input passes forever, which is the failure mode these
// guards exist to prevent: a renamed heading or a moved code block would
// otherwise look identical to a document that still agrees with the server.
function notFound(document: Document, what: string): never {
  throw new Error(
    `${document.name} no longer contains ${what}. It moved or was renamed; ` +
      `point this check at where it went, or delete the claim it was checking.`,
  );
}

export interface FencedBlock {
  readonly language: string;
  readonly body: string;
  // 1-based, for a failure message a reader can navigate to.
  readonly startLine: number;
}

function fencedBlocks(document: Document): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let open: { language: string; startLine: number; body: string[] } | null = null;

  document.lines.forEach((line, index) => {
    const fence = /^```(?<language>[a-z]*)\s*$/u.exec(line);
    if (fence === null) {
      open?.body.push(line);
      return;
    }
    if (open === null) {
      open = { language: fence.groups?.language ?? '', startLine: index + 1, body: [] };
      return;
    }
    blocks.push({ language: open.language, body: open.body.join('\n'), startLine: open.startLine });
    open = null;
  });

  return blocks;
}

// The block a reader would take as the output of `marker`: the first fence in
// `language` that starts after the command containing `marker`. Anchoring on
// the command rather than on a heading means the pairing checked is the one
// the page actually shows.
export function blockAfter(document: Document, marker: string, language: string): FencedBlock {
  const commandLine = document.lines.findIndex((line) => line.includes(marker));
  if (commandLine === -1) notFound(document, `the command \`${marker}\``);

  const block = fencedBlocks(document).find(
    (candidate) => candidate.language === language && candidate.startLine > commandLine + 1,
  );
  if (block === undefined) {
    notFound(document, `a ${language} block after the command \`${marker}\``);
  }
  return block;
}

export function jsonAfter(document: Document, marker: string): Record<string, unknown> {
  const block = blockAfter(document, marker, 'json');
  const parsed: unknown = JSON.parse(block.body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${document.name}:${String(block.startLine)} shows a JSON block after \`${marker}\` ` +
        `that is not an object`,
    );
  }
  return { ...parsed };
}

export interface Table {
  readonly headings: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly startLine: number;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/u, '')
    .replace(/\|\s*$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

// Tables are addressed by their heading row rather than by position, so
// inserting a table above one of these does not silently repoint a check.
export function tableWithHeadings(document: Document, headings: readonly string[]): Table {
  for (const [index, line] of document.lines.entries()) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length !== headings.length) continue;
    if (!headings.every((heading, column) => cells[column] === heading)) continue;

    const rows: string[][] = [];
    for (let cursor = index + 2; cursor < document.lines.length; cursor += 1) {
      const row = document.lines[cursor];
      if (!row?.trimStart().startsWith('|')) break;
      rows.push(splitRow(row));
    }
    if (rows.length === 0)
      notFound(document, `any row under the table \`${headings.join(' | ')}\``);
    return { headings, rows, startLine: index + 1 };
  }
  notFound(document, `a table headed \`${headings.join(' | ')}\``);
}

export function backticked(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? '');
}
