export { CLIENT_LIST_LIMIT } from '@odudu/contracts/admin';

import { groupedNumber } from '#/shared/services/format';

// A row added and left empty is no entry, and one padded with spaces is
// the entry without them: what is counted and what is sent.
export function entriesOf(rows: readonly string[]): string[] {
  return rows.map((row) => row.trim()).filter((row) => row !== '');
}

// What a list holds against what the server lets it hold.
export function listCount(rows: readonly string[], limit: number, noun: string): string {
  const count = entriesOf(rows).length;
  if (count <= limit) return `${groupedNumber(count)} of ${groupedNumber(limit)} ${noun}.`;
  return `${groupedNumber(count - limit)} over the limit of ${groupedNumber(limit)} ${noun}.`;
}
