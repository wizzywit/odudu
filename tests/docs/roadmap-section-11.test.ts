import { describe, expect, it } from 'vitest';
import { loadDocument } from './markdown.js';

// Complements the closing pass's reading of the roadmap against section 11:
// this checks that each roadmap sentence for a phase (Next and Later; not
// Decided against, which places nothing) has its words in that phase's row,
// that each gap-audit capability and NEXT.md placement has a roadmap line, and
// that a bullet which is not phase-tagged fails rather than being skipped. It
// works per sentence, so a clause added to a mapped sentence still needs a
// reader; whether each mapping is still true is the pass's reading.
const ROADMAP = 'apps/docs/content/en/roadmap.md';
const SPEC = 'docs/superpowers/specs/2026-09-10-odudu-design.md';
const NEXT = 'docs/NEXT.md';

const squash = (text: string): string => text.replace(/\s+/gu, ' ').toLowerCase();

function criteria(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of loadDocument(SPEC).lines) {
    const phase = /^\| (P\d+[a-z]?) +\|/u.exec(line)?.[1];
    if (phase !== undefined) rows.set(phase, squash(line));
  }
  return rows;
}

function bullets(heading: string, lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) throw new Error(`no ${heading}`);
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3} /u.test(line)) break;
    if (line.startsWith('- ')) found.push(line.slice(2));
    else if (found.length > 0 && /^\s+\S/u.test(line)) {
      found[found.length - 1] = `${found[found.length - 1] ?? ''} ${line.trim()}`;
    }
  }
  return found;
}

const roadmapLines = (): readonly string[] => loadDocument(ROADMAP).lines;

interface Bullet {
  readonly phase: string;
  readonly text: string;
}

function phaseBullets(): Bullet[] {
  return ['## Next', '## Later'].flatMap((heading) =>
    bullets(heading, roadmapLines()).flatMap((item) => {
      const match = /^\*\*(P\d+[a-z]?)\b[^*]*\*\*\s*(.*)$/u.exec(item);
      if (match?.[1] !== undefined) return [{ phase: match[1], text: match[2] ?? '' }];
      if (/^\*\*[^*]+\*\*: P\d+[a-z]?\b/u.test(item)) return [];
      throw new Error(`${ROADMAP} ${heading}: a bullet with no phase tag: ${item.slice(0, 60)}`);
    }),
  );
}

const SMALLER = '**Smaller capabilities, each placed on a phase**';

function smallerCapabilities(): { capability: string; phase: string }[] {
  const lines = roadmapLines();
  const start = lines.indexOf(SMALLER);
  if (start === -1) throw new Error(`${ROADMAP} has no ${SMALLER}`);
  const found: { capability: string; phase: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('**') || line.startsWith('## ')) break;
    const match = /^- \*\*(.+?)\*\*: (P\d+[a-z]?)\b/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      found.push({ capability: match[1], phase: match[2] });
    }
  }
  return found;
}

// Every roadmap line for a phase, as the roadmap says it: its bullet and each
// smaller capability placed on it.
function roadmapFor(phase: string): string {
  const own = phaseBullets().filter((bullet) => bullet.phase === phase);
  const small = smallerCapabilities().filter((item) => item.phase === phase);
  return squash(
    [...own.map((bullet) => bullet.text), ...small.map((item) => item.capability)].join(' '),
  );
}

// A sentence of a roadmap bullet, the phrases of its phase's criterion that
// carry it, or none where the sentence states a status and places nothing.
const CLAIMS: readonly (readonly [phase: string, sentence: string, ...criterion: string[]])[] = [
  [
    'P4g',
    'Release candidates are out',
    'signed, with an sbom',
    'pinned by digest',
    'one-file `compose.yaml`',
    'release process and changelog written down',
    'a documentation site built with docusaurus',
    'a landing page;',
    'example applications',
  ],
  ['P4g', 'The stable `0.1.0` follows'],
  ['P4j', 'A tenant is reached at', 'custom domain', 'public address of its own'],
  ['P4j', 'Odudu keeps a table of verified domains', 'table of verified domains', 'on-demand tls'],
  ['P4j', 'The issuer, the cookies', 'issuer', 'cookie scope', 'webauthn rp id'],
  ['P5a', 'It passes the MCP authorization profile', 'claude and cursor configuration examples'],
  ['P5a', 'The admin API as tools', 'read-only by default', 'protect an mcp server with odudu'],
  [
    'P5a',
    'The server does not yet publish',
    'protected-resource and authorization-server metadata',
    '`idempotency-key` header',
  ],
  ['P5a', 'The admin API has no `Idempotency-Key` header today', '`idempotency-key` header'],
  ['P4f', 'A "me" API', '"me" api', 'application-initiated actions'],
  [
    'P4f',
    'It also brings fresh recovery codes',
    'fresh set of recovery codes',
    'warning when fewer',
    'owner notice by mail',
    "end the subject's other sessions",
  ],
  [
    'P4f',
    'A person can ask for a new verification email',
    'a new verification email',
    'per-tenant totp policy',
    'a session shown against the device',
  ],
  [
    'P4f',
    'A link an administrator mailed',
    'a place to return to for a mailed link an administrator issued',
  ],
  ['P4f', 'It also reconciles accounts', 'differ only by case', 'more than one click'],
  [
    'P4h',
    'Every string in the admin console',
    'read from a catalogue',
    'a locale switch',
    'right-to-left locale',
  ],
  ['P4h', 'Lists sort by', '`intl.collator`', 'machine-readable `code`'],
  ['P4h', 'It also sends the failure screen', "failure screen's error id sent to the server"],
  [
    'P4i',
    'Official libraries',
    'framework-neutral javascript core',
    'a react package',
    'a next.js package',
    'node middleware',
  ],
  ['P4i', 'A single-page app can run', 'backend-for-frontend option', 'rfc 10017'],
  [
    'P4i',
    'A typed admin API client',
    'typed admin api client generated from the published openapi',
  ],
  ['P4i', 'Each ships with a guide', 'a runnable example in ci', 'a version of its own'],
  ['P4i', 'They wrap what exists', 'the "me" api wrapped'],
  ['P5', 'Budgets, attenuation and approval', 'ciba approvals'],
  ['P5', 'Delegation depth becomes a setting', '`max_depth`'],
  [
    'P5',
    'A restriction on a grant holds',
    'persisted on the grant',
    'revoking every grant exchanged from it',
  ],
  ['P5b', 'The irreversible tools', 'out-of-band approval'],
  ['P6', 'Sign in with Google', 'upstream oidc idp'],
  [
    'P6',
    'A person is created on first sign-in',
    'provisioned just in time',
    'account-linking decision',
  ],
  [
    'P7',
    'LDAP-backed sign-in',
    'ldap-backed authentication',
    'scim 2.0 inbound provisioning',
    'beyond the 10,000',
  ],
  ['P8', 'Odudu as a SAML identity provider', 'saml 2.0 idp'],
  ['P7', 'Usernames that look alike', 'confusable-character policy'],
  ['P9', 'Policy evaluation and UMA 2.0', 'uma 2.0', 'resource server as a first-class thing'],
  ['P10', 'Third-party providers loaded', 'third-party provider loads without a rebuild'],
  [
    'P10',
    'A tenant can choose which claim mappers',
    'claim mapper an operator supplies',
    'eventlistener',
  ],
  ['P11', 'One instance only today', 'advisory lock', 'per-origin throttle'],
  [
    'P11',
    'Also a deadline',
    'deadline to the outbound dns lookups',
    'a metrics endpoint',
    'documented p99',
  ],
  [
    'P11',
    'The admin API also authenticates',
    'authenticates a request before it reads and checks its body',
  ],
  ['P11', 'Upgrades run in place', 'migration runner', 'concurrently', 'backfilled in batches'],
  ['P11', 'Audit events are partitioned', 'partitioned by month', 'chunked and resumable'],
  ['P11', 'A Helm chart', 'helm chart', 'kubernetes manifests'],
  [
    'P12',
    'Secrets read from somewhere',
    'secrets sourced',
    'restoring into an empty database',
    'neither a superuser nor able to bypass row-level security',
  ],
  ['P12', 'Odudu also moves to the next even-numbered Node', 'node runtime moved by hand'],
  [
    'P13',
    'Pushed authorization requests',
    'pushed authorization requests',
    'dpop (rfc 9449)',
    'a device-code client (rfc 8628)',
    'client_secret_jwt',
    'self_signed_tls_client_auth',
    'acr_values',
  ],
  ['P13', 'A client can read, change and delete', "rfc 7592's client configuration endpoint"],
  ['P14', 'More platforms', 'vue, svelte and angular', 'rfc 8252', 'go, java, .net, php and ruby'],
  ['P14', 'Headless sign-in components', 'flow api', 'headless sign-in components'],
  ['P14', 'An agent library', 'agent library for delegation'],
];

const sentencesOf = (text: string): string[] => text.split(/(?<=\.)\s+(?=[A-Z])/u);

describe('the roadmap and section 11 of the design spec agree', () => {
  it('writes into a phase criterion every claim the roadmap makes for the phase', () => {
    const rows = criteria();
    const missing: string[] = [];
    const unmapped: string[] = [];
    for (const { phase, text } of phaseBullets()) {
      for (const sentence of sentencesOf(text)) {
        const claim = CLAIMS.find(([p, start]) => p === phase && sentence.startsWith(start));
        if (claim === undefined) {
          unmapped.push(`${phase}: ${sentence.slice(0, 60)}`);
          continue;
        }
        for (const phrase of claim.slice(2)) {
          if (!(rows.get(phase) ?? '').includes(phrase)) missing.push(`${phase}: ${phrase}`);
        }
      }
    }
    expect(unmapped, 'a roadmap sentence with no entry in CLAIMS').toEqual([]);
    expect(missing, 'roadmap work its phase criterion does not name').toEqual([]);
  });

  it('keeps no claim for a sentence the roadmap no longer has', () => {
    const all = phaseBullets().flatMap(({ phase, text }) =>
      sentencesOf(text).map((sentence) => ({ phase, sentence })),
    );
    const stale = CLAIMS.filter(
      ([phase, start]) =>
        !all.some((item) => item.phase === phase && item.sentence.startsWith(start)),
    ).map(([phase, start]) => `${phase}: ${start}`);
    expect(stale).toEqual([]);
  });

  it('puts on the roadmap every capability a criterion takes from the gap audit', () => {
    const MARKER = 'from the p4d gap audit: ';
    const placed = smallerCapabilities().map((item) => ({
      phase: item.phase,
      capability: squash(item.capability.replace(/ \(.*$/u, '')),
    }));
    const missing: string[] = [];
    let seen = 0;
    // A phase that has shipped leaves "Next" and "Later" for "Shipped".
    const shipped = new Set(['P4b']);
    for (const [phase, row] of criteria()) {
      const at = row.indexOf(MARKER);
      if (at === -1) continue;
      const segment = row.slice(at + MARKER.length).split('; from ')[0] ?? '';
      const trimmed = segment.replace(/\s*\|\s*$/u, '');
      for (const fragment of trimmed.split('; ')) {
        const capability =
          fragment
            .split(' — ')[0]
            ?.split(', with ')[0]
            ?.replace(/ \(.*$/u, '') ?? '';
        seen += 1;
        if (shipped.has(phase)) continue;
        if (!placed.some((item) => item.phase === phase && item.capability === capability)) {
          missing.push(`${phase}: ${capability}`);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(12);
    expect(missing, 'criterion work with no roadmap line').toEqual([]);
  });

  // What docs/NEXT.md places on a phase and the roadmap line that carries it,
  // or why it is not a roadmap matter.
  const PLACEMENTS: readonly (readonly [
    start: string,
    phases: string[],
    roadmap: string[] | string,
  ])[] = [
    [
      'Twelve administrative capabilities',
      ['P4f'],
      'carried by the gap-audit capability check above',
    ],
    [
      '`tests/lint/production-guard-order.test.ts`',
      ['P12'],
      'a test maintenance note for the boot rework',
    ],
    ['Localization has its catalogue', ['P4h'], ['catalogue']],
    ['The admin router validates a body', ['P11'], ['authenticates a request before it reads']],
    ["The console's failure ID", ['P4h'], ['failure screen']],
    ['No scope means anything', ['P9'], ['resource server as a first-class thing']],
    [
      '`/introspect` answers every registered client',
      ['P9'],
      ['resource server as a first-class thing'],
    ],
    ['RFC 7523 has no clause table', ['P13'], 'protocol-note bookkeeping, no product behaviour'],
    [
      'The session cap is per browser',
      ['P4f'],
      'an internal race on the cap, no product behaviour',
    ],
    ['Migrations are hard cutovers', ['P11'], ['migrations run at boot with no lock']],
    ['`audit_events` at 100,000,000 rows', ['P11'], ['partitioned by month']],
    ['Tenant delete is one transaction', ['P11'], ['chunked and resumable']],
    ['The audit trail can be rewritten', ['P12'], ['audit trail']],
    ['Self-service credential gaps', ['P4f'], ['other sessions', 'passkey']],
    ['No composite index serves', ['P11'], 'an index decision that waits on the measurement'],
    ['An address can be spent by anyone', ['P11'], ['per-address mail limit']],
    ['A person who confirms a "finish registration"', ['P4f'], ['more than one click']],
    ['Accounts that differ only by the case', ['P4f'], ['differ only by case']],
    ['The Node major moves by hand', ['P12'], ['even-numbered node lts']],
  ];

  function nextPlacements(): { start: string; phases: string[] }[] {
    const lines = loadDocument(NEXT).lines;
    const owed = bullets('### Work owed, and the phase each belongs to', lines);
    const open = lines.filter((line) => line.startsWith('| ') && /\*\*P\d+[a-z]?\*\*/u.test(line));
    return [...owed, ...open.map((row) => row.slice(2))]
      .map((text) => ({
        start: text,
        phases: [...text.matchAll(/\*\*(P\d+[a-z]?)\*\*/gu)].map((match) => match[1] ?? ''),
      }))
      .filter((item) => item.phases.length > 0 || item.start.startsWith('**Twelve'));
  }

  it('places on the roadmap every phase placement docs/NEXT.md makes', () => {
    const found = nextPlacements();
    expect(found.length).toBeGreaterThanOrEqual(PLACEMENTS.length);
    const problems: string[] = [];
    for (const item of found) {
      const entry = PLACEMENTS.find(([start]) =>
        squash(item.start.replace(/^\*\*/u, '')).startsWith(squash(start)),
      );
      if (entry === undefined) {
        problems.push(`no entry in PLACEMENTS: ${item.start.slice(0, 60)}`);
        continue;
      }
      const [, phases, roadmap] = entry;
      if (typeof roadmap === 'string') continue;
      const text = phases.map(roadmapFor).join(' ');
      for (const phrase of roadmap) {
        if (!text.includes(phrase)) problems.push(`${phases.join('/')}: ${phrase}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps no placement for an entry docs/NEXT.md no longer has', () => {
    const found = nextPlacements().map((item) => squash(item.start.replace(/^\*\*/u, '')));
    const stale = PLACEMENTS.filter(
      ([start]) => !found.some((text) => text.startsWith(squash(start))),
    ).map(([start]) => start);
    expect(stale).toEqual([]);
  });

  it('has a roadmap line for every phase a placement names', () => {
    for (const [, phases] of PLACEMENTS) {
      for (const phase of phases) {
        expect(roadmapFor(phase), phase).not.toBe('');
      }
    }
  });
});
