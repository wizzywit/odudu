const items = ['a', 'b'];
const table = new Map<string, number>([['a', 1]]);

export function withMore(items: string[]): string[] {
  items.push('c');
  return items;
}

export function build(): string[] {
  const rows: string[] = [];
  let total = 0;
  for (const row of items) {
    rows.push(row);
    total += 1;
  }
  const table = new Map<string, number>();
  table.set('x', total);
  return rows;
}

export function read(key: string): number | undefined {
  return table.get(key);
}
