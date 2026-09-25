import { describe, expect, it } from 'vitest';
import {
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '../../packages/domain-tenant/src/index.js';
import { ADMIN_ROUTES } from '../../packages/protocol-admin/src/index.js';
import { backticked, loadDocument, sections, type Section } from './markdown.js';

const GUIDE = 'docs/admin-paths.md';

// `tests/docs/endpoints.test.ts` already holds this document's endpoint table
// to Fastify's own route set, in both directions. What it cannot see is the
// prose: which capability each section says a route needs, and which problem
// bodies it shows. Both rot silently — renaming a capability or a problem
// `type` breaks nothing a reader would notice until they trusted the page.

const REAL_CAPABILITIES = new Set<string>([...TENANT_CAPABILITIES, MANAGE_TENANTS, TENANT_ADMIN]);

// Names the document mentions in order to say they do **not** exist. Asserted
// absent rather than skipped: if one is ever added, the sentence denying it
// becomes false and this check is what says so.
const DENIED_BY_THE_DOCUMENT = ['view-clients', 'view-sessions'];

// Every `type` value `packages/protocol-admin/src/view/problem.ts` and its
// callers construct. Written out rather than read from those call sites,
// deliberately: a check that derives its expectation from the code it checks
// agrees by construction and can no longer fail. Extending this by hand when
// a fifth type is added is the point, not an omission to tidy away.
const EMITTABLE_PROBLEM_TYPES = new Set([
  'about:blank',
  'about:blank#unauthorized',
  'about:blank#forbidden',
  'about:blank#not-found',
]);

const CAPABILITY_SHAPED = /^(?:view|manage)-[a-z]+(?:-[a-z]+)*$/u;

// `PATCH /clients/{id}` in one heading and `PATCH /subjects/:id` in another
// name the same kind of thing; the route table spells both `:id`.
function normalise(path: string): string {
  return path.replace(/\{(?<name>[a-zA-Z]+)\}/gu, ':$<name>');
}

const ENDPOINT_IN_HEADING = /^(?<method>GET|POST|PUT|PATCH|DELETE) (?<path>\/\S*)$/u;

function endpointsNamedBy(section: Section): { method: string; path: string }[] {
  return backticked(section.heading).flatMap((item) => {
    const match = ENDPOINT_IN_HEADING.exec(item.trim());
    if (match === null) return [];
    return [{ method: match.groups?.method ?? '', path: normalise(match.groups?.path ?? '') }];
  });
}

/** The section whose heading names this route, matching on the pattern's tail. */
function sectionFor(
  all: Section[],
  route: { method: string; pattern: string },
): Section | undefined {
  return all.find((section) =>
    endpointsNamedBy(section).some(
      (named) => named.method === route.method && route.pattern.endsWith(named.path),
    ),
  );
}

describe('docs/admin-paths.md says what the admin API actually requires', () => {
  const document = loadDocument(GUIDE);
  // 34 headings when this was written; the floor guards against an extractor
  // that silently stops finding them. `tests/docs/structure.test.ts` is what
  // holds a heading to rendering as a heading.
  const all = sections(document, 20);

  it('names only capabilities that exist', () => {
    const named = new Set(
      all
        .flatMap((section) => backticked(`${section.heading}\n${section.body}`))
        .filter((item) => CAPABILITY_SHAPED.test(item)),
    );

    const unknown = [...named].filter(
      (item) => !REAL_CAPABILITIES.has(item) && !DENIED_BY_THE_DOCUMENT.includes(item),
    );

    expect(unknown.sort(), `${GUIDE} names capabilities no role provides`).toEqual([]);
  });

  it('is right that the capabilities it denies do not exist', () => {
    const wronglyDenied = DENIED_BY_THE_DOCUMENT.filter((item) => REAL_CAPABILITIES.has(item));

    expect(
      wronglyDenied,
      `${GUIDE} says these do not exist, and they now do — the prose denying them is false`,
    ).toEqual([]);
  });

  it('gives every guarded route a section that names its capability', () => {
    const wrong = ADMIN_ROUTES.flatMap((route) => {
      const capability = route.capability;
      if (capability === null) return [];
      const section = sectionFor(all, route);
      if (section === undefined) return [`${route.method} ${route.pattern}: no section names it`];
      if (backticked(`${section.heading}\n${section.body}`).includes(capability)) return [];
      return [
        `${route.method} ${route.pattern}: "${section.heading}" ` +
          `(line ${String(section.headingLine)}) never names \`${capability}\``,
      ];
    });

    expect(wrong, `${GUIDE} and ADMIN_ROUTES disagree about what a route requires`).toEqual([]);
  });

  it('shows only problem types the code can emit', () => {
    // Anchored on the pair, not on `"type"` alone: a client's own
    // representation carries `"type":"public"` and a subject's
    // `"type":"user"`, neither of which is a problem document.
    const matches = [...document.lines.join('\n').matchAll(/\{"type":"(?<type>[^"]*)","title":/gu)];
    const shown = new Set(matches.map((match) => match.groups?.type ?? ''));

    expect(
      matches.length,
      `${GUIDE} shows no problem responses at all, so this check holds nothing`,
    ).toBeGreaterThanOrEqual(20);
    expect(
      [...shown].filter((type) => !EMITTABLE_PROBLEM_TYPES.has(type)).sort(),
      `${GUIDE} shows problem types this server cannot produce`,
    ).toEqual([]);
  });
});
