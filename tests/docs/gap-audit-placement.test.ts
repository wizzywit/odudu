import { expect, it } from 'vitest';
import { loadDocument } from './markdown.js';

// An item placed in a phase only on the roadmap page is placed nowhere that
// phase reads: its own exit criterion is what decides whether it closes.
const HEADING = '**Smaller capabilities, each placed on a phase**';
const ITEM = /^- \*\*(.+?)\*\*: (P\d+[a-z]?)\b/u;
const ROW = /^\| (P\d+[a-z]?) +\|/u;

function placedItems(): { capability: string; phase: string }[] {
  const { lines } = loadDocument('apps/docs/content/en/roadmap.md');
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error(`apps/docs/content/en/roadmap.md has no ${HEADING}`);
  const items: { capability: string; phase: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('**') || line.startsWith('## ')) break;
    const match = ITEM.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      items.push({ capability: match[1], phase: match[2] });
    }
  }
  return items;
}

function criteria(): Map<string, string> {
  const { lines } = loadDocument('docs/superpowers/specs/2026-09-10-odudu-design.md');
  const rows = new Map<string, string>();
  for (const line of lines) {
    const phase = ROW.exec(line)?.[1];
    if (phase !== undefined) rows.set(phase, line.replace(/\s+/gu, ' ').toLowerCase());
  }
  return rows;
}

it("names every audit-placed capability in its phase's exit criterion", () => {
  const items = placedItems();
  expect(items.length).toBeGreaterThanOrEqual(8);
  const rows = criteria();
  const missing = items
    .filter(({ capability, phase }) => !(rows.get(phase) ?? '').includes(capability.toLowerCase()))
    .map(({ capability, phase }) => `${phase}: ${capability}`);
  expect(missing).toEqual([]);
});
