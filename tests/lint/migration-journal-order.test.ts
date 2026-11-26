import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Entry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

const JOURNAL = JSON.parse(
  readFileSync(new URL('../../packages/db/drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: Entry[] };

// Drizzle applies an entry only if its `when` is above the newest one a database
// has recorded, so an entry whose `when` is out of order is skipped silently on
// every database that already ran a later one.
describe('the migration journal', () => {
  it('has an idx equal to each entry’s position', () => {
    const wrong = JOURNAL.entries.filter((entry, position) => entry.idx !== position);
    expect(wrong.map((entry) => entry.tag)).toEqual([]);
  });

  it('has a `when` that is strictly increasing', () => {
    const wrong = JOURNAL.entries.filter(
      (entry, position) => position > 0 && entry.when <= (JOURNAL.entries[position - 1]?.when ?? 0),
    );
    expect(wrong.map((entry) => entry.tag)).toEqual([]);
  });

  it('numbers its tags in increasing order', () => {
    const numbers = JOURNAL.entries.map((entry) => Number(entry.tag.slice(0, 4)));
    expect(numbers.every((n, i) => i === 0 || n > (numbers[i - 1] ?? 0))).toBe(true);
  });
});
