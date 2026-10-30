import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOURNEYS, SECTIONS } from '#docs/nav.ts';
import { PAGES_BASE, PAGES_DOCS_BASE } from '#docs/site.config.ts';
import { SIDEBAR_ITEMS } from '#docs/sidebars.ts';
import {
  DOCS_ROOT,
  distDir,
  docsDir,
  fileOf,
  htmlFiles,
  internalReferences,
  isDocumentRoute,
  load,
  routeOf,
  walk,
} from '#docs/tests/support/dist.ts';

const SECTION_ORDER = [
  'Introduction',
  'Quick start',
  'Guides',
  'Concepts',
  'Admin console',
  'Operating Odudu',
  'Reference',
  'Security',
  'Contributing',
];

const SIDEBAR_ORDER = [
  'Start here',
  'Introduction',
  'Quick start',
  'Guides',
  'Concepts',
  'Admin console',
  'Operating Odudu',
  'Reference',
  'Security',
  'Contributing',
];

const CONTENT = path.join(DOCS_ROOT, 'content/en');

function sidebarLinks(page: string): string[] {
  const $ = load(path.join(docsDir('pages'), page));
  return $('.theme-doc-sidebar-menu a.menu__link')
    .map((_, element) => $(element).attr('href'))
    .get();
}

describe('the information architecture', () => {
  it('has the nine sections, in the order the design gives', () => {
    expect(SECTIONS.map((section) => section.label)).toEqual(SECTION_ORDER);
  });

  it('lists the sections in the sidebar of a built page, in order', () => {
    expect(sidebarLinks('quick-start/index.html')).toEqual(
      SECTIONS.map((section) => `${PAGES_DOCS_BASE}${section.route}`),
    );
    expect(
      SIDEBAR_ITEMS.map((item) => {
        if (typeof item !== 'object') return '';
        if (item.type === 'html') return item.value;
        return 'label' in item ? item.label : '';
      }),
    ).toEqual(SIDEBAR_ORDER);
  });

  it('has no anchor without an href in the sidebar, which a crawler cannot follow', () => {
    const $ = load(path.join(docsDir('pages'), 'quick-start/index.html'));
    expect($('.theme-doc-sidebar-menu a:not([href])').length).toBe(0);
  });

  it('opens the guides to the journeys, in order, and no further', () => {
    const links = sidebarLinks('guides/index.html');
    const journeys = JOURNEYS.map((journey) => `${PAGES_DOCS_BASE}${journey.route}`);
    const start = links.indexOf(`${PAGES_DOCS_BASE}guides/`);

    expect(links.slice(start + 1, start + 1 + journeys.length)).toEqual(journeys);
  });

  it('opens the concepts to their eight pages, in order', () => {
    const links = sidebarLinks('concepts/index.html');
    const start = links.indexOf(`${PAGES_DOCS_BASE}concepts/`);
    expect(
      links
        .slice(start + 1, start + 9)
        .map((href) => href.slice(`${PAGES_DOCS_BASE}concepts/`.length)),
    ).toEqual([
      'tenants/',
      'clients/',
      'scopes/',
      'roles-and-groups/',
      'sessions/',
      'tokens/',
      'consent-and-audit/',
      'branding/',
    ]);
  });

  it('opens the admin console to the tour and its seventeen pages, in order', () => {
    const links = sidebarLinks('admin-console/index.html');
    const start = links.indexOf(`${PAGES_DOCS_BASE}admin-console/`);
    expect(
      links
        .slice(start + 1, start + 19)
        .map((href) => href.slice(`${PAGES_DOCS_BASE}admin-console/`.length)),
    ).toEqual([
      'tour/',
      'overview/',
      'subjects/',
      'groups/',
      'roles/',
      'clients/',
      'client-branding/',
      'scopes/',
      'registration-tokens/',
      'sign-in-flow/',
      'signing-keys/',
      'sessions/',
      'settings/',
      'branding/',
      'email/',
      'audit-trail/',
      'tenants/',
      'system-administrators/',
    ]);
  });

  it('keeps the recorded transcripts out of the navigation until a reader is inside them', () => {
    const outside = [
      ...sidebarLinks('reference/index.html'),
      ...sidebarLinks('guides/index.html'),
    ].filter(
      (href) =>
        href.startsWith(`${PAGES_DOCS_BASE}reference/transcripts/`) &&
        href !== `${PAGES_DOCS_BASE}reference/transcripts/`,
    );

    expect(outside).toEqual([]);
  });

  it('gives every section at least one page that exists', () => {
    for (const section of SECTIONS) {
      const found = ['.md', '.mdx'].some((extension) =>
        existsSync(path.join(CONTENT, `${section.id}${extension}`)),
      );
      expect(found, section.id).toBe(true);
    }
  });

  it('reaches every page from the home page in one click to its section and one more to the page, the footer aside', () => {
    const dir = distDir('pages');
    const pages = new Map<string, string[]>();
    for (const file of htmlFiles(dir)) {
      const route = routeOf(dir, file, PAGES_BASE);
      if (!isDocumentRoute(route, PAGES_BASE)) continue;
      const $ = load(file);
      $('footer').remove();
      const links = internalReferences($, route)
        .filter((reference) => reference.attribute.startsWith('a['))
        .map((reference) => reference.pathname);
      pages.set(route, links);
    }
    const depth = new Map<string, number>([[PAGES_BASE, 0]]);
    const queue = [PAGES_BASE];
    for (const route of queue) {
      for (const next of pages.get(route) ?? []) {
        if (pages.has(next) && !depth.has(next)) {
          depth.set(next, (depth.get(route) ?? 0) + 1);
          queue.push(next);
        }
      }
    }
    // A recorded transcript and an operation page of the admin API are looked
    // up from a group index the reference links, so each is one click further
    // than the sections' own pages. The admin API overview and the index of
    // an area are not: the reference links them.
    const transcripts = `${PAGES_DOCS_BASE}reference/transcripts/`;
    const adminApi = `${PAGES_DOCS_BASE}reference/generated/admin-api/`;
    const allowed = (route: string): number => {
      if (route.startsWith(transcripts)) return 3;
      const inside = route.startsWith(adminApi) ? route.slice(adminApi.length) : '';
      return inside.split('/').filter((part) => part !== '').length >= 2 ? 3 : 2;
    };
    const tooFar = [...pages.keys()].filter(
      (route) => (depth.get(route) ?? Infinity) > allowed(route),
    );
    expect(tooFar).toEqual([]);
    const homeLinks = pages.get(PAGES_BASE) ?? [];
    for (const section of SECTIONS) {
      expect(homeLinks, section.label).toContain(`${PAGES_DOCS_BASE}${section.route}`);
    }
    for (const journey of JOURNEYS) {
      expect(homeLinks, journey.label).toContain(`${PAGES_DOCS_BASE}${journey.route}`);
    }
  });

  it('builds a page for every section', () => {
    const dir = distDir('pages');
    for (const section of SECTIONS) {
      const file = fileOf(dir, PAGES_BASE, `${PAGES_DOCS_BASE}${section.route}`);
      expect(file !== null && existsSync(file), section.route).toBe(true);
    }
  });
});

describe('the stub pages', () => {
  const MARKER = /<!-- filled by Increment \d+[a-z]? -->/u;
  const unfilled = JSON.parse(
    readFileSync(path.join(DOCS_ROOT, 'tests/unfilled.json'), 'utf8'),
  ) as string[];

  it('has no unfilled marker', () => {
    const marked = walk(CONTENT)
      .filter((file) => file.endsWith('.md') && MARKER.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(CONTENT, file).split(path.sep).join('/'));
    expect(marked.filter((file) => !unfilled.includes(file))).toEqual([]);
  });

  // Set by the step that closes the documentation, where no page may remain a stub.
  it.runIf(process.env.DOCS_REQUIRE_FILLED === '1')('lists no page at all', () => {
    expect(unfilled).toEqual([]);
  });

  it('lists only pages that still carry the marker', () => {
    const stale = unfilled.filter((file) => {
      const full = path.join(CONTENT, file);
      return !existsSync(full) || !MARKER.test(readFileSync(full, 'utf8'));
    });
    expect(stale).toEqual([]);
  });
});
