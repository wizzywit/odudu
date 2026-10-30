import { describe, expect, it } from 'vitest';
import { loadDocument, loadSource, tableWithHeadings } from './markdown.js';

const PAGE = 'apps/docs/content/en/roadmap.md';
const SPEC = 'docs/superpowers/specs/2026-09-10-odudu-design.md';
const RELEASE = 'P4g';
// Closed after the release row in the table, which is in execution order.
const SHIPPED_AFTER_RELEASE = ['P4b'];

// What the roadmap table orders: every phase before the release is closed, the
// release is this one, and the rest are ahead.
function phases(): { closed: string[]; ahead: string[] } {
  const table = tableWithHeadings(loadSource(SPEC), ['#', 'Phase', 'Effort', 'Exit criterion']);
  const all = table.rows.map((row) => row[0] ?? '').filter((cell) => /^P\d+[a-z]?$/u.test(cell));
  const at = all.indexOf(RELEASE);
  if (at === -1) throw new Error(`${SPEC} has no ${RELEASE} row`);
  const after = all.slice(at + 1);
  return {
    closed: [
      ...all.slice(0, at),
      ...after.filter((phase) => SHIPPED_AFTER_RELEASE.includes(phase)),
    ],
    ahead: after.filter((phase) => !SHIPPED_AFTER_RELEASE.includes(phase)),
  };
}

function items(heading: string): string[] {
  const { lines } = loadDocument(PAGE);
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) throw new Error(`${PAGE} has no ${heading}`);
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) found.push(line);
    else if (found.length > 0 && /^\s+\S/u.test(line)) {
      found[found.length - 1] = `${found[found.length - 1] ?? ''} ${line.trim()}`;
    }
  }
  return found;
}

const prose = (): string =>
  loadDocument(PAGE)
    .lines.join('\n')
    .replace(/^---\n[\s\S]*?\n---\n/u, '');

describe('the roadmap page', () => {
  it('has its four parts, in order', () => {
    const headings = loadDocument(PAGE)
      .lines.filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    expect(headings).toEqual(['Shipped', 'Next', 'Later', 'Decided against, and why']);
  });

  it('orders Next as the design spec orders the phases, none dropped', () => {
    const { ahead } = phases();
    const named = items('## Next').flatMap(
      (item) => /^- \*\*(P\d+[a-z]?)\b/u.exec(item)?.[1] ?? [],
    );
    // From this release to the last phase before the breadth phases begin.
    expect(named).toEqual([RELEASE, ...ahead.slice(0, ahead.indexOf('P5b') + 1)]);
  });

  it('says in Shipped that the image and quick start are published', () => {
    const { lines } = loadDocument(PAGE);
    const start = lines.findIndex((line) => line.startsWith('## Shipped'));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    const shipped = lines.slice(start, end).join('\n');
    expect(shipped).not.toMatch(/built from source|has yet to publish|until it ships/iu);
    expect(shipped).toMatch(
      /The container image and the Docker Compose quick start are published/u,
    );
    expect(shipped).toMatch(/pulls without signing in/u);
  });

  it('says front-channel logout as the logout code does', () => {
    const logout = loadDocument('packages/protocol-oidc/src/usecase/logout.ts').lines.join('\n');
    expect(logout).not.toMatch(
      /decision\.redirectTo === null\s*\?\s*await frontChannelLogoutUrls/u,
    );
    expect(logout).toMatch(/await frontChannelLogoutUrls\(deps, tenantId, issuer, session\.id\)/u);
    const roadmap = prose();
    expect(roadmap).toMatch(/frames are shown on every logout/u);
    expect(roadmap).toMatch(/sent there once the frames have loaded/u);
    expect(roadmap).not.toMatch(/redirects without rendering the front-channel frames/u);
  });

  it('puts every phase after Next in Later, and none in both', () => {
    const { ahead } = phases();
    const next = new Set(
      items('## Next').flatMap((item) => /^- \*\*(P\d+[a-z]?)\b/u.exec(item)?.[1] ?? []),
    );
    const later = new Set(
      items('## Later').flatMap((item) => /^- \*\*(P\d+[a-z]?)\b/u.exec(item)?.[1] ?? []),
    );
    for (const phase of ahead.filter((candidate) => /^P(6|7|8|9|1\d)$/u.test(candidate))) {
      expect(later.has(phase), phase).toBe(true);
      expect(next.has(phase), phase).toBe(false);
    }
  });

  it('never cites a closed phase, and cites the release only as the stable release', () => {
    const { closed } = phases();
    expect(closed.length).toBeGreaterThanOrEqual(8);
    const text = prose();
    const cited = closed.filter((phase) => new RegExp(`\\b${phase}\\b`, 'u').test(text));
    expect(cited).toEqual([]);
    for (const sentence of text.split(/(?<=[.!?:])\s+|\n/u)) {
      if (new RegExp(`\\b${RELEASE}\\b`, 'u').test(sentence)) {
        expect(sentence, sentence).toMatch(/stable release/iu);
      }
    }
  });

  it('does not recount history: no dates, no "used to", no "moved from"', () => {
    expect(prose().replace(/\]\([^)]*\)/gu, ']')).not.toMatch(
      /\b20\d\d-\d\d-\d\d\b|used to|was moved|moved from|until \d/u,
    );
  });

  // Each entry the earlier, longer page placed against a phase, a decision or an
  // ADR, by a phrase that identifies it and the places it named. Reworded or
  // moved, an entry must still say the one and name the other.
  const PLACED: readonly (readonly [phrase: string, ...places: string[]])[] = [
    ['login_hint', 'ADR 0043'],
    ['acr_values', 'P13'],
    ['request objects', 'P13'],
    ['PKCE is mandatory', 'ADR 0016'],
    ['response_type=code', 'ADR 0016'],
    ['`resource`', 'decision'],
    ['recovery codes', 'P4f'],
    ['other sessions', 'P4f'],
    ['CIBA', 'P5'],
    ['device authorization grant', 'P13'],
    ['password credentials grant', 'decision'],
    ['DPoP', 'P13'],
    ['client_secret_jwt', 'P13'],
    ['self_signed_tls_client_auth', 'P13'],
    ['aggregated or distributed claims', 'decision'],
    ['cannot add a new mapper', 'P10'],
    ['EventListener', 'P10'],
    ['/introspect', 'decision'],
    ['refused credential or session change', 'ADR 0037'],
    ['`odudu seed` creates', 'decision'],
    ['SAML', 'P8'],
    ['LDAP', 'P7'],
    ['identity brokering', 'P6'],
    ['authorization services', 'P9'],
    ["person's password is not chosen", 'decision'],
    ['SCIM 2.0', 'P7'],
    ['10,000', 'P7'],
    ['MCP server', 'P5a'],
    ['TLS is ended in front', 'ADR 0020'],
    ['One instance only', 'P11'],
    ['deadline', 'P11'],
    ['signed container image', 'P4g'],
    ['Secrets read from somewhere', 'P12'],
    ['backup and restore', 'P12'],
    ['Expired state', 'ADR 0024'],
    ['Four operator commands', 'ADR 0024'],
    ['more required actions', 'P4f'],
    ['several sign-in flows', 'P4f'],
    ['per-step authenticator configuration', 'P4f'],
    ['a breached-password check', 'P4f'],
    ['a public address of its own', 'P4j'],
    ['custom subject attributes', 'P7'],
    ['fine-grained admin permissions', 'P9'],
    ['per-client dedicated mappers', 'P10'],
    ['a metrics endpoint', 'P11'],
    ['key import', 'P12'],
    ['client registration policies', 'P13'],
    ['admin impersonation', 'P13'],
    ['hosted layer', 'ADR 0042'],
    ['Liquid-style template logic', 'a user asks'],
  ];

  it.each(PLACED)(
    'still says "%s", placed where the earlier page placed it',
    (phrase, ...places) => {
      const all = [
        ...items('## Next'),
        ...items('## Later'),
        ...items('## Decided against, and why'),
      ];
      const found = all.filter((item) => item.toLowerCase().includes(phrase.toLowerCase()));
      expect(found.length, `no item says ${phrase}`).toBeGreaterThan(0);
      for (const place of places) {
        expect(
          found.some((item) => item.includes(place)),
          `${phrase} is not placed at ${place}`,
        ).toBe(true);
      }
    },
  );
});
