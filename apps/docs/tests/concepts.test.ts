import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT, docsDir, load } from '#docs/tests/support/dist.ts';

const REPO = path.resolve(DOCS_ROOT, '../..');
const CONTENT = path.join(DOCS_ROOT, 'content/en/concepts');
const COMPONENT = path.join(DOCS_ROOT, 'src/shared/view/Diagram');

const PAGES = [
  'tenants',
  'clients',
  'scopes',
  'roles-and-groups',
  'sessions',
  'tokens',
  'consent-and-audit',
  'branding',
] as const;

function source(page: string): string {
  return readFileSync(path.join(CONTENT, page === 'index' ? 'index.md' : `${page}.mdx`), 'utf8');
}

function body(page: string): string {
  return source(page).replace(/^---\n[\s\S]*?\n---\n/u, '');
}

const DIAGRAM =
  /<Diagram\s+name="([^"]+)"\s+title="([^"]+)"\s+desc="([^"]+)"\s*\/>\n\n[*_]In words: ([^\n]+)[*_]/gu;

// The prose without the picture and its description, so a number has to be
// stated in the text a reader reads, not only beside the diagram.
function prose(page: string): string {
  return body(page).replace(DIAGRAM, '');
}

function repoText(file: string): string {
  return readFileSync(path.join(REPO, file), 'utf8');
}

describe('the concept pages', () => {
  it('are exactly the eight the section lists, beside its index', () => {
    const found = readdirSync(CONTENT)
      .filter((name) => /\.mdx?$/u.test(name) && name !== 'index.md')
      .map((name) => name.replace(/\.mdx$/u, ''))
      .sort();
    expect(found).toEqual([...PAGES].sort());
  });

  it('link to every one of them from the index', () => {
    const index = source('index');
    for (const page of PAGES) expect(index, page).toContain(`(./${page}.mdx`);
  });

  it.each(PAGES)('%s runs to between 400 and 900 words', (page) => {
    const words = body(page)
      .replace(DIAGRAM, '')
      .replace(/^import .*$/mu, '')
      .split(/\s+/u)
      .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    expect(words).toBeGreaterThanOrEqual(400);
    expect(words).toBeLessThanOrEqual(900);
  });

  it.each(PAGES)('%s says nothing about repositories, tests or plans', (page) => {
    expect(body(page)).not.toMatch(
      /\b(ADR|docs\/|packages\/|apps\/|\.test\.ts|Increment|phase P\d)/u,
    );
  });
});

// The diagrams a page embeds, in order: the one named for it, then any more it explains with.
const DIAGRAMS_OF: Readonly<Record<string, readonly string[]>> = {
  branding: ['branding', 'branding-parts', 'branding-publishing'],
};

function diagramsOf(page: string): readonly string[] {
  return DIAGRAMS_OF[page] ?? [page];
}

describe('each concept page embeds its diagrams', () => {
  it.each(PAGES)('%s has its diagrams, each with a title and a description', (page) => {
    const found = [...body(page).matchAll(DIAGRAM)];
    expect(found.map((match) => match[1])).toEqual(diagramsOf(page));
    for (const [, , title = '', desc = '', inWords = ''] of found) {
      expect(title.length).toBeGreaterThan(5);
      expect(desc.length).toBeGreaterThan(80);
      // The Markdown copy drops the drawing and keeps this sentence.
      expect(inWords).toBe(desc);
    }
    expect(body(page)).not.toMatch(/<img\b|!\[/u);
    expect(body(page)).toContain("import { Diagram } from '@site/src/shared/view/Diagram';");
  });

  it.each(PAGES)('the built %s page carries each described svg inline', (page) => {
    const $ = load(path.join(docsDir('pages'), 'concepts', page, 'index.html'));
    const svgs = $('article svg[role="img"]').toArray();
    const found = [...body(page).matchAll(DIAGRAM)];
    expect(svgs).toHaveLength(found.length);
    expect($('article img[src*="diagrams"]').length).toBe(0);
    svgs.forEach((svg, index) => {
      const [, , title = '', desc = ''] = found[index] ?? [];
      expect($(svg).find('title').text()).toBe(title);
      expect($(svg).find('desc').text()).toBe(desc);
      expect($(svg).attr('aria-labelledby')).toBe($(svg).find('title').attr('id'));
      expect($(svg).attr('aria-describedby')).toBe($(svg).find('desc').attr('id'));
    });
  });

  it.each(PAGES)('the Markdown copy of %s keeps the words and drops the drawing', (page) => {
    const copy = readFileSync(path.join(docsDir('pages'), 'concepts', `${page}.md`), 'utf8');
    for (const [, , , desc = ''] of body(page).matchAll(DIAGRAM)) expect(copy).toContain(desc);
    expect(copy).not.toMatch(/<Diagram|<svg|import Diagram/u);
  });
});

describe('the diagram component', () => {
  const sources = readdirSync(COMPONENT)
    .filter((name) => /\.tsx?$/u.test(name))
    .map((name) => [name, readFileSync(path.join(COMPONENT, name), 'utf8')] as const);

  it.each(sources)('%s carries nothing the docs policy refuses', (_name, text) => {
    expect(text).not.toMatch(/dangerouslySetInnerHTML|<script|<image|<foreignObject|<use\b/u);
    expect(text).not.toMatch(/\bstyle=|href=|https?:\/\//u);
    // A colour is a custom property of the site, so the diagram follows its toggle.
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|prefers-color-scheme/u);
  });

  it('draws every diagram, each with a name a page uses', () => {
    const diagrams = sources.find(([name]) => name === 'diagrams.tsx')?.[1] ?? '';
    for (const name of PAGES.flatMap(diagramsOf))
      expect(diagrams, name).toMatch(new RegExp(`['"]?${name}['"]?:`, 'u'));
  });
});

// A claim a page makes in prose, the text on the page that makes it, and the
// place in the code or schema that settles it.
interface Fact {
  readonly page: (typeof PAGES)[number];
  readonly says: string;
  readonly file: string;
  readonly holds: RegExp;
}

const FACTS: readonly Fact[] = [
  {
    page: 'sessions',
    says: '30 minutes',
    file: 'packages/db/drizzle/0028_realm_session_lifespans.sql',
    holds: /ADD COLUMN sso_session_idle_seconds integer NOT NULL DEFAULT 1800;/u,
  },
  {
    page: 'sessions',
    says: '10 hours',
    file: 'packages/db/drizzle/0028_realm_session_lifespans.sql',
    holds: /ADD COLUMN sso_session_max_seconds integer NOT NULL DEFAULT 36000;/u,
  },
  {
    page: 'sessions',
    says: '25 sessions',
    file: 'packages/db/drizzle/0048_sessions_remembered_and_cap.sql',
    holds: /ADD COLUMN max_sessions_per_browser integer NOT NULL DEFAULT 25;/u,
  },
  {
    page: 'sessions',
    says: 'ten recovery codes',
    file: 'packages/authn-flows/src/service/authenticators/recovery.ts',
    holds: /export const RECOVERY_CODE_COUNT = 10;/u,
  },
  {
    page: 'tokens',
    says: '300 seconds',
    file: 'packages/db/drizzle/0082_tenant_lifetimes.sql',
    holds: /ADD COLUMN access_token_ttl_seconds integer NOT NULL DEFAULT 300,/u,
  },
  {
    page: 'tokens',
    says: '14 days',
    file: 'packages/db/drizzle/0082_tenant_lifetimes.sql',
    holds: /ADD COLUMN refresh_token_ttl_seconds integer NOT NULL DEFAULT 1209600,/u,
  },
  {
    page: 'tokens',
    says: 'at+jwt',
    file: 'packages/protocol-admin/src/usecase/authenticate-admin.ts',
    holds: /typ: 'at\+jwt'/u,
  },
  {
    page: 'consent-and-audit',
    says: '90 days',
    file: 'packages/db/drizzle/0068_audit_retention.sql',
    holds: /ADD COLUMN audit_retention_days integer NOT NULL DEFAULT 90;/u,
  },
  {
    page: 'clients',
    says: 'PKCE',
    file: 'packages/contracts/src/discovery.ts',
    holds: /code_challenge_methods_supported/u,
  },
];

describe('the numbers the concept pages state are the ones the code and schema hold', () => {
  it.each(FACTS)('$page says "$says", and $file holds it', ({ page, says, file, holds }) => {
    expect(prose(page)).toContain(says);
    expect(repoText(file)).toMatch(holds);
  });
});

const BRANDING_FACTS: readonly Fact[] = [
  {
    page: 'branding',
    says: 'up to twenty',
    file: 'packages/domain-theme/src/service/record.ts',
    holds: /export const THEME_VERSION_LIMIT = 20;/u,
  },
  {
    page: 'branding',
    says: '4.5:1',
    file: 'packages/domain-theme/src/service/contrast.ts',
    holds: /export const TEXT_CONTRAST = 4\.5;/u,
  },
];

describe('the numbers the branding page states are the ones the code holds', () => {
  it.each(BRANDING_FACTS)(
    '$page says "$says", and $file holds it',
    ({ page, says, file, holds }) => {
      expect(prose(page)).toContain(says);
      expect(repoText(file)).toMatch(holds);
    },
  );
});

const MORE_FACTS: readonly Fact[] = [
  {
    page: 'tenants',
    says: 'odudu init',
    file: 'apps/server/src/cli/registry.ts',
    holds: /create the system tenant/u,
  },
  {
    page: 'tenants',
    says: 'same email address',
    file: 'packages/db/drizzle/0023_users_email_unique.sql',
    holds:
      /CREATE UNIQUE INDEX users_email_unique ON users \([a-z_]+, email\) WHERE email IS NOT NULL/u,
  },
  {
    page: 'scopes',
    says: '`invalid_scope`',
    file: 'packages/protocol-oidc/src/service/authorize-validation.ts',
    holds:
      /scopesAreGrantable\(params\.scope, knownScopes, clientScopes\)\) return reject\('invalid_scope'\)/u,
  },
  {
    page: 'sessions',
    says: '`subject.recovery_codes_revoke`',
    file: 'packages/protocol-admin/src/usecase/subjects.ts',
    holds: /action: 'subject\.recovery_codes_revoke'/u,
  },
  {
    page: 'sessions',
    says: 'require_new_set=false',
    file: 'packages/protocol-admin/src/view/routes/account-recovery.ts',
    holds: /requireNewSet: query\.require_new_set !== 'false'/u,
  },
  {
    page: 'sessions',
    says: 'Removing the last authenticator app removes the whole set',
    file: 'packages/authn-flows/src/usecase/second-factor-removed.ts',
    holds:
      /if \(standing\.hasTotp\) return \{ recoveryCodesRevoked: 0 \};[\s\S]*deleteRecoveryCodes/u,
  },
  {
    page: 'sessions',
    says: 'idle limit cannot be longer',
    file: 'packages/db/drizzle/0028_realm_session_lifespans.sql',
    holds: /CHECK \(sso_session_idle_seconds <= sso_session_max_seconds\)/u,
  },
  {
    page: 'sessions',
    says: 'caps them at 25',
    file: 'packages/db/drizzle/0048_sessions_remembered_and_cap.sql',
    holds: /CHECK \(max_sessions_per_browser BETWEEN 1 AND 32\)/u,
  },
  {
    page: 'scopes',
    says: 'full_scope_allowed',
    file: 'packages/db/drizzle/0017_roles.sql',
    holds: /full_scope_allowed boolean NOT NULL DEFAULT false/u,
  },
  {
    page: 'scopes',
    says: 'Include all roles in tokens',
    file: 'apps/admin-console/src/features/clients/service/tokens.ts',
    holds: /FULL_SCOPE_LABEL = 'Include all roles in tokens'/u,
  },
  {
    page: 'roles-and-groups',
    says: 'effective-roles',
    file: 'packages/protocol-admin/src/view/routes/subjects.ts',
    holds: /effective-roles/u,
  },
];

describe('the claims about recovery codes and the sign-in tenant, each against its source', () => {
  it.each(MORE_FACTS)('$page says "$says", and $file holds it', ({ page, says, file, holds }) => {
    expect(prose(page)).toContain(says);
    expect(repoText(file)).toMatch(holds);
  });
});

describe('the concept pages', () => {
  // A name in code font that looks like a column, a setting, a claim or an
  // audit action must be one the code, the schema or the contracts spell.
  it('names only settings, claims and actions the code spells', () => {
    const roots = [
      'packages/contracts/src',
      'packages/db/drizzle',
      'packages/domain-audit/src',
      'packages/protocol-oidc/src',
      'packages/protocol-admin/src',
      'packages/authn-flows/src',
      'packages/domain-tenant/src',
      'packages/domain-authz/src',
    ];
    const corpus = roots
      .flatMap((root) => listFiles(path.join(REPO, root)))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const NAME = /`([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)`/gu;
    const unknown = PAGES.flatMap((page) =>
      [...body(page).matchAll(NAME)]
        .map((match) => ({ page, name: match[1] ?? '' }))
        .filter(({ name }) => {
          if (corpus.includes(name)) return false;
          // A field named through the object that holds it, as in `settings.audit_retention_days`.
          const [owner = '', ...rest] = name.split('.');
          return !(owner === 'settings' && rest.length === 1 && corpus.includes(rest.join('.')));
        }),
    );
    expect(unknown).toEqual([]);
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(full);
    return /\.(ts|sql)$/u.test(entry.name) ? [full] : [];
  });
}
