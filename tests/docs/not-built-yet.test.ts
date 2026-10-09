import { expect, it } from 'vitest';
import { loadDocument, tableWithHeadings } from './markdown.js';

// README's "What is not built yet" names the phase each gap waits on. A row
// outlives its phase silently: the consent-screen row still named P3a long
// after P3a shipped the screen. NEXT.md's opening sentence is where the
// finished phases are listed, so a row naming one of them is stale.
const COMPLETE = /^\*\*(.+?) are complete\b/u;

function completedPhases(): Set<string> {
  const line = loadDocument('docs/NEXT.md').lines.find((candidate) => COMPLETE.test(candidate));
  const listed = line === undefined ? undefined : COMPLETE.exec(line)?.[1];
  if (listed === undefined) throw new Error('docs/NEXT.md names no completed phases');
  return new Set(listed.match(/\bP\d+[a-z]?\b/gu) ?? []);
}

it('names no finished phase as the owner of something not yet built', () => {
  const complete = completedPhases();
  expect(complete.size).toBeGreaterThan(3);
  const table = tableWithHeadings(loadDocument('README.md'), ['', 'Where it stands']);
  const stale = table.rows.filter((row) => complete.has(row[1] ?? '')).map((row) => row[0]);
  expect(stale).toEqual([]);
});
