export { CLIENT_LIST_LIMIT } from '@odudu/contracts/admin';

import { limitReading } from '#/shared/lib/services/format';

// A row added and left empty is no entry, and one padded with spaces is
// the entry without them: what is counted and what is sent.
export function entriesOf(rows: readonly string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row !== '');
}

// What a list holds against what the server lets it hold.
export function listCount(rows: readonly string[], limit: number, noun: string): string {
  return limitReading(entriesOf(rows).length, limit, noun, { overNoun: 'limit' }).text;
}
