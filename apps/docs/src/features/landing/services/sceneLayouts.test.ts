import { describe, expect, it } from 'vitest';
import { LAYOUTS, pathData } from '@site/src/features/landing/services/sceneLayouts';

describe('the sign-in scene layouts', () => {
  it('draws each route from its first sample to its last and ends it with an arrowhead', () => {
    for (const layout of Object.values(LAYOUTS)) {
      for (const route of Object.values(layout.routes)) {
        const first = route.points[0];
        const last = route.points[route.points.length - 1];
        expect(pathData(route.points).startsWith(`M${(first?.[0] ?? 0).toFixed(1)}`)).toBe(true);
        expect(route.head.at).toEqual(last);
      }
    }
  });
});
