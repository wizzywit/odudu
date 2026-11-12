import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { bypassesRowLevelSecurity, createDatabase, type DatabaseHandle } from '@odudu/db';
import { insertBreachedHashes, type BreachedHashRow } from '@odudu/domain-identity';
import { loadConfig, OduduError } from '@odudu/kernel';

export type HashRow = BreachedHashRow;

/** Two parameters a row keeps a statement far below the driver's limit of 65,535. */
export const CHUNK_ROWS = 5_000;

const SHA1_HEX = /^[0-9A-F]{40}$/;

/**
 * One line of the published range format, `SHA1HASH` or `SHA1HASH:count`.
 * The count is dropped, and a blank line is nothing.
 */
export function parseHashLine(raw: string): HashRow | null {
  const line = raw.trim();
  if (line === '') return null;
  const hash = (line.split(':', 1)[0] ?? '').toUpperCase();
  if (!SHA1_HEX.test(hash)) throw new Error('not a SHA-1 hash');
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

export interface LoadReport {
  read: number;
  inserted: number;
}

/**
 * Reads hash lines and hands them on in chunks, holding one chunk at a time.
 * A line that is not a hash stops the load and names its number; the chunks
 * already handed on stay, and the same file can be loaded again.
 */
export async function loadHashLines(
  lines: AsyncIterable<string>,
  insert: (rows: readonly HashRow[]) => Promise<number>,
): Promise<LoadReport> {
  const report: LoadReport = { read: 0, inserted: 0 };
  let chunk: HashRow[] = [];
  let lineNumber = 0;
  for await (const raw of lines) {
    lineNumber += 1;
    let row: HashRow | null;
    try {
      row = parseHashLine(raw);
    } catch {
      throw new OduduError(
        'breached_passwords_bad_line',
        `line ${String(lineNumber)} is not a SHA-1 hash, so this is not a list of them`,
      );
    }
    if (row === null) continue;
    report.read += 1;
    chunk.push(row);
    if (chunk.length === CHUNK_ROWS) {
      report.inserted += await insert(chunk);
      chunk = [];
    }
  }
  if (chunk.length > 0) report.inserted += await insert(chunk);
  return report;
}

/**
 * The dataset is global, and the serving role may only read it, so the load
 * runs on the owner connection, which has to escape row-level security to
 * write it.
 */
export async function loadBreachedPasswordFile(
  owner: DatabaseHandle,
  path: string,
): Promise<LoadReport> {
  if (!(await bypassesRowLevelSecurity(owner))) {
    throw new OduduError(
      'breached_passwords_cannot_load',
      'the dataset is written on a connection that bypasses row-level security; ' +
        'ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  const input = createReadStream(path, { encoding: 'utf8' });
  try {
    return await loadHashLines(createInterface({ input, crlfDelay: Infinity }), (rows) =>
      insertBreachedHashes(owner.db, rows),
    );
  } finally {
    input.destroy();
  }
}

/** `odudu breached-passwords load <file>`. */
export async function breachedPasswordsCommand(argv: readonly string[]): Promise<LoadReport> {
  const [subcommand, path, ...rest] = argv;
  if (subcommand !== 'load' || path === undefined || rest.length > 0) {
    throw new OduduError(
      'breached_passwords_usage',
      'usage: odudu breached-passwords load <file>; see odudu help breached-passwords',
    );
  }
  const owner = createDatabase(loadConfig().ODUDU_DATABASE_URL);
  try {
    return await loadBreachedPasswordFile(owner, path);
  } finally {
    await owner.close();
  }
}
