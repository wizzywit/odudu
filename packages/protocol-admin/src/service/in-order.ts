// `rows` in the order of `keys`: what a page read by key in one statement and
// fetched by id in another has to be put back into. A key with no row is left out.
export function inOrderOf<R>(
  keys: readonly string[],
  rows: readonly R[],
  keyOf: (row: R) => string,
): R[] {
  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  const ordered: R[] = [];
  for (const key of keys) {
    const row = byKey.get(key);
    if (row !== undefined) ordered.push(row);
  }
  return ordered;
}
