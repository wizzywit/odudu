import { SECTIONS, START_ROUTES, type Section } from '@site/nav';

function sectionOf(route: string): Section {
  const found = SECTIONS.find((candidate) => candidate.route === route);
  if (found === undefined) throw new Error(`nav.ts has no section at ${route}`);
  return found;
}

export interface StartCard {
  section: Section;
  look: 'primary' | 'plain';
}

export interface HomeMapSections {
  start: StartCard[];
  guides: Section;
  deeper: Section[];
}

// Where to begin, the guides the journeys belong to, and every other section.
export function homeMapSections(): HomeMapSections {
  const guides = sectionOf('guides/');
  return {
    // The first place to begin is the one the card list leads with.
    start: START_ROUTES.map((route, index) => ({
      section: sectionOf(route),
      look: index === 0 ? 'primary' : 'plain',
    })),
    guides,
    deeper: SECTIONS.filter(
      (section) => section !== guides && !START_ROUTES.includes(section.route),
    ),
  };
}
