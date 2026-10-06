export { CLIENT_LIST_LIMIT } from '@odudu/contracts/admin';

const COUNT = new Intl.NumberFormat('en');

// What a list holds against what the server lets it hold; a row left empty is no entry.
export function listCount(rows: readonly string[], limit: number, noun: string): string {
  const count = rows.filter((row) => row.trim() !== '').length;
  if (count <= limit) return `${COUNT.format(count)} of ${COUNT.format(limit)} ${noun}.`;
  return `${COUNT.format(count - limit)} over the limit of ${COUNT.format(limit)} ${noun}.`;
}
