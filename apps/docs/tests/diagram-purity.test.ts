import { describe, expect, it } from 'vitest';
import { DRAWINGS, type DiagramName } from '#docs/src/shared/view/Diagram/diagrams.tsx';
import { drawn } from '#docs/tests/support/diagram-markup.ts';

const names = Object.keys(DRAWINGS) as DiagramName[];

// The drawings are built once, when the module loads, and drawn on every
// render: server, hydration, a re-render. A drawing that keeps a cursor outside
// `draw` is right the first time and wrong ever after.
describe('the concept diagrams', () => {
  it('declare every one the pages use', () => {
    expect(names.length).toBe(8);
  });

  it.each(names)('%s draws the same elements however often it is drawn', (name) => {
    const first = drawn(name);
    expect(first.length).toBeGreaterThan(200);
    expect(drawn(name)).toBe(first);
    expect(drawn(name)).toBe(first);
  });

  it('draws the sessions timeline row, its four segments in order', () => {
    const drawing = drawn('sessions');
    const labels = [...drawing.matchAll(/<text[^>]*>([^<]*)<\/text>/gu)].map((m) => m[1]);
    expect(labels.slice(2, 6)).toEqual(['active', 'quiet', 'active', 'too long']);
    const lefts = [...drawing.matchAll(/<rect x="(\d+)" y="40"/gu)].map((m) => Number(m[1]));
    expect(lefts).toEqual([14, 84, 128, 198]);
  });
});
