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

// CommonMark §4.5, which these documents live or die by: an **opening** fence
// may carry an info string, a **closing** fence may carry nothing but its own
// backticks and whitespace. So "``` and then a sentence" closes nothing, and
// every line after it — headings included — is swallowed into the block.
// `structuralProblems` below is the check that says so; every walker here
// reads fences the same way so that none of them disagrees about where a
// block ends.
const FENCE = /^(?<ticks>`{3,})(?<info>.*)$/u;

export interface FenceSpan {
  readonly language: string;
  /** 1-based line of the opening fence. */
  readonly startLine: number;
  /** 1-based line of the closing fence, or null where the block never closes. */
  readonly endLine: number | null;
  readonly body: readonly string[];
  /** Lines that look like a closing fence but carry trailing prose, so close nothing. */
  readonly swallowedFences: readonly number[];
}

export interface DocumentScan {
  readonly spans: readonly FenceSpan[];
  /** True for a line that sits inside a fenced block, indexed from 0. */
  readonly fenced: readonly boolean[];
}

export function scanFences(document: Document): DocumentScan {
  const spans: FenceSpan[] = [];
  const fenced: boolean[] = [];
  let open: {
    ticks: string;
    language: string;
    startLine: number;
    body: string[];
    swallowed: number[];
  } | null = null;

  for (const [index, line] of document.lines.entries()) {
    const match = FENCE.exec(line);
    const info = match?.groups?.info ?? '';
    const ticks = match?.groups?.ticks ?? '';

    if (match !== null && open === null) {
      open = { ticks, language: info.trim(), startLine: index + 1, body: [], swallowed: [] };
      fenced.push(false);
      continue;
    }
    if (match !== null && open !== null && ticks.length >= open.ticks.length) {
      if (info.trim() === '') {
        spans.push({
          language: open.language,
          startLine: open.startLine,
          endLine: index + 1,
          body: open.body,
          swallowedFences: open.swallowed,
        });
        open = null;
        fenced.push(false);
        continue;
      }
      open.swallowed.push(index + 1);
    }
    open?.body.push(line);
    fenced.push(open !== null);
  }

  if (open !== null) {
    spans.push({
      language: open.language,
      startLine: open.startLine,
      endLine: null,
      body: open.body,
      swallowedFences: open.swallowed,
    });
  }

  return { spans, fenced };
}

export function fencedBlocks(document: Document): FencedBlock[] {
  return scanFences(document).spans.map((span) => ({
    language: span.language,
    body: span.body.join('\n'),
    startLine: span.startLine,
  }));
}

export interface StructuralProblem {
  /** 1-based. */
  readonly line: number;
  readonly what: string;
}

/**
 * The ways a fence can silently change what a document says. Each one shipped
 * here or was one edit away from shipping, and a formatter catches none of
 * them: it reformats around a malformed fence rather than refusing it.
 */
export function structuralProblems(document: Document): StructuralProblem[] {
  const { spans, fenced } = scanFences(document);
  const problems: StructuralProblem[] = [];

  for (const span of spans) {
    if (span.endLine === null) {
      problems.push({ line: span.startLine, what: 'a fenced block that is never closed' });
    }
    if (span.language.includes('`')) {
      problems.push({
        line: span.startLine,
        what: `an opening fence whose info string holds a backtick: \`${span.language}\``,
      });
    }
    for (const line of span.swallowedFences) {
      problems.push({
        line,
        what:
          'a fence line carrying trailing prose, which closes nothing — everything ' +
          `below it is swallowed into the block opened at line ${String(span.startLine)}`,
      });
    }
  }

  // A `#` line inside a fence is ordinarily a shell comment. `##` and deeper
  // are not: no command in these documents starts one, so a level-2 heading
  // reading as code means the surrounding fence has taken it, and every
  // anchor pointing at it is dead.
  document.lines.forEach((line, index) => {
    if (fenced[index] === true && /^#{2,6} /u.test(line)) {
      problems.push({
        line: index + 1,
        what: `a heading that renders as code, so its anchor is dead: ${line.trim()}`,
      });
    }
  });

  return problems.sort((a, b) => a.line - b.line);
}

export interface Section {
  readonly heading: string;
  /** 1-based. */
  readonly headingLine: number;
  readonly body: string;
}

/** The `##` sections a reader sees, which is not every line that starts `## `. */
export function sections(document: Document, atLeast: number): Section[] {
  const { fenced } = scanFences(document);
  const found: Section[] = [];
  const body: string[] = [];
  let heading: { text: string; line: number } | null = null;

  const close = (): void => {
    if (heading === null) return;
    found.push({ heading: heading.text, headingLine: heading.line, body: body.join('\n') });
    body.length = 0;
  };

  for (const [index, line] of document.lines.entries()) {
    if (fenced[index] !== true && line.startsWith('## ')) {
      close();
      heading = { text: line.slice(3), line: index + 1 };
      continue;
    }
    body.push(line);
  }
  close();

  if (found.length < atLeast) {
    notFound(
      document,
      `at least ${String(atLeast)} \`##\` sections (found ${String(found.length)})`,
    );
  }
  return found;
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

// A fence sometimes shows more than one JSON value — a JWT header on its
// own line above the payload it belongs to, in this document's convention —
// so a check reading "the JSON in this fence" needs every top-level object
// in it, not just the one `JSON.parse` on the whole body would choke on.
// Brace-counting is string-aware (a value like `"error":"invalid_client"}`
// must not close early) but otherwise assumes the fence holds nothing but
// JSON objects and surrounding whitespace, which is what this document uses
// a `json` fence for.
export function jsonObjectsIn(body: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const parsed: unknown = JSON.parse(body.slice(start, i + 1));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          objects.push(parsed as Record<string, unknown>);
        }
        start = -1;
      }
    }
  }

  return objects;
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
