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

// How many times a page is read again because a row vanished under it.
const ATTEMPTS = 5;

// A page read as its keys, then its rows by key. A row deleted between the two
// statements would shorten the page, and with it hide the page after it, so the
// keys are read again (they no longer hold it) until every key has its row.
export async function readKeyedPage<R>(
  readKeys: () => Promise<readonly string[]>,
  readRows: (keys: readonly string[]) => Promise<readonly R[]>,
  keyOf: (row: R) => string,
): Promise<R[]> {
  let page: R[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const keys = await readKeys();
    if (keys.length === 0) return [];
    page = inOrderOf(keys, await readRows(keys), keyOf);
    if (page.length === keys.length) return page;
  }
  return page;
}
