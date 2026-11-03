import { describe, expect, it } from 'vitest';
import { INK, SURFACE, vertical } from '@site/src/shared/lib/services/diagram';

describe('the diagram parts', () => {
  it('draws a vertical line between two heights', () => {
    expect(vertical(10, 20, 80)).toBe('M10 20 L10 80');
  });

  it('colours everything from the site custom properties', () => {
    const values = [
      ...Object.values(INK),
      ...Object.values(SURFACE).flatMap((s) => [s.fill, s.stroke]),
    ];
    expect(values.every((value) => value.startsWith('var(--'))).toBe(true);
  });
});
