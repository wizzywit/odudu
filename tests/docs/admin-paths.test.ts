import { describe, expect, it } from 'vitest';
import {
  MANAGE_TENANTS,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '../../packages/domain-tenant/src/index.js';
import { ADMIN_ROUTES } from '../../packages/protocol-admin/src/index.js';
import { backticked, loadDocument, type Document } from './markdown.js';

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
// callers construct. A transcript showing anything else is showing bytes this
// server cannot produce.
const EMITTABLE_PROBLEM_TYPES = new Set([
  'about:blank',
  'about:blank#unauthorized',
  'about:blank#forbidden',
  'about:blank#not-found',
]);

const CAPABILITY_SHAPED = /^(?:view|manage)-[a-z]+(?:-[a-z]+)*$/u;

interface Section {
  readonly heading: string;
  readonly headingLine: number;
  readonly body: string;
}

// CommonMark's rule, not a lenient approximation of it: an opening fence may
// carry an info string, a **closing** fence may carry nothing but its own
// backticks. A line like "``` and then some prose" therefore closes nothing,
// and everything after it — headings included — is swallowed into the block.
// This document shipped exactly that, hiding a heading and killing three
// anchors, past a clean `pnpm format:check`.
function sections(document: Document): Section[] {
  const found: Section[] = [];
  const body: string[] = [];
  let heading: { text: string; line: number } | null = null;
  let fence = '';

  const close = (): void => {
    if (heading === null) return;
    found.push({ heading: heading.text, headingLine: heading.line, body: body.join('\n') });
    body.length = 0;
  };

  for (const [index, line] of document.lines.entries()) {
    const ticks = /^(?<ticks>`{3,})(?<rest>.*)$/u.exec(line);
    if (ticks !== null) {
      const run = ticks.groups?.ticks ?? '';
      const rest = ticks.groups?.rest ?? '';
      if (fence === '') fence = run;
      else if (run.length >= fence.length && rest.trim() === '') fence = '';
    }
    if (fence === '' && line.startsWith('## ')) {
      close();
      heading = { text: line.slice(3), line: index + 1 };
      continue;
    }
    body.push(line);
  }
  close();

  if (fence !== '') {
    throw new Error(`${document.name} has a fenced block that is never closed`);
  }
  if (found.length < 20) {
    throw new Error(
      `${document.name} yielded ${String(found.length)} sections; there were 34 when this ` +
        `check was written, so the headings moved or this extractor stopped seeing them.`,
    );
  }
  return found;
}

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
  const all = sections(document);

  it('hides no heading inside a fenced block', () => {
    const written = document.lines.flatMap((line, index) =>
      line.startsWith('## ') ? [{ heading: line.slice(3), line: index + 1 }] : [],
    );
    const rendered = new Set(all.map((section) => section.headingLine));

    expect(
      written
        .filter((candidate) => !rendered.has(candidate.line))
        .map((candidate) => `${GUIDE}:${String(candidate.line)} ${candidate.heading}`),
      'these look like headings in the source and render as code, so their anchors are dead',
    ).toEqual([]);
  });

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
