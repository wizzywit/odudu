import { useEffect, useState } from 'react';
import {
  bandAfter,
  bandKey,
  bandTargets,
  currentSection,
  type NavGroup,
} from '#/pages/settings/services/sectionPlan';

// A heading reaches the reading band near the top of the screen when its
// section has scrolled to it, whatever the height of the section.
const BAND = '-12% 0px -78% 0px';

// The section in the reading band, found by `sectionOf` for each heading id.
export function useCurrentSection(
  groups: readonly NavGroup[],
  sectionOf: (headingId: string) => Element | null,
): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const key = bandKey(groups);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = bandTargets(key);
    const order = targets.map((target) => target.id);
    const ids = new Map<Element, string>();
    let inBand: ReadonlySet<string> = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        inBand = bandAfter(
          inBand,
          entries.map((entry) => ({
            id: ids.get(entry.target) ?? '',
            intersecting: entry.isIntersecting,
          })),
        );
        setCurrent((last) => currentSection(order, inBand, last));
      },
      { rootMargin: BAND },
    );
    for (const target of targets) {
      const section = sectionOf(target.headingId);
      if (section === null) continue;
      ids.set(section, target.id);
      observer.observe(section);
    }
    return () => {
      observer.disconnect();
    };
  }, [key, sectionOf]);
  return current;
}
