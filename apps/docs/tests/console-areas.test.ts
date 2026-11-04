import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const REPO = path.resolve(DOCS_ROOT, '../..');
const CONTENT = path.join(DOCS_ROOT, 'content/en');
const CONSOLE = path.join(REPO, 'apps/admin-console/src/features');
const CONSOLE_PAGES = path.join(REPO, 'apps/admin-console/src/pages');
const PAGES = path.join(CONTENT, 'admin-console');

// The page that describes each directory of console features. A directory with
// no page of its own is named here with where it is described instead.
const PAGE_OF_FEATURE: Readonly<Record<string, string>> = {
  overview: 'overview',
  subjects: 'subjects',
  groups: 'groups',
  roles: 'roles',
  clients: 'clients',
  scopes: 'scopes',
  'registration-tokens': 'registration-tokens',
  flow: 'sign-in-flow',
  'signing-keys': 'signing-keys',
  'tenant-sessions': 'sessions',
  settings: 'settings',
  branding: 'branding',
  email: 'email',
  domains: 'domains',
  audit: 'audit-trail',
  tenants: 'tenants',
  'system-admins': 'system-administrators',
};

// Sign-in, the menu and the screen shown when a page fails live in widgets,
// not among the features; the console's home is a page of its own that the
// tour opens with.
const DESCRIBED_BY_THE_TOUR = ['console-home'];

// Parts of other pages, described on the pages that show them: adding an
// administrator and giving one capabilities (Tenants, System administrators),
// the capability list (those two and a subject), the Members tab (Groups and
// Roles). own-roles holds no screen, only what a write there takes from the
// caller. record-activity is the Activity tab of a record, described on each
// record's page. role-mapping is the roles editor of a group and a scope, and
// scope-assignment the assigned-scopes list of a client and of a scope.
// branding-editor is the editors the Branding area and a client's tab share.
const DESCRIBED_BY_ITS_PAGES = [
  'begin-administrator',
  'branding-editor',
  'grant-administrator',
  'own-roles',
  'record-activity',
  'role-mapping',
  'scope-assignment',
  'subject-capabilities',
  'subject-members',
];

// The area each menu entry opens, by the path areas.ts gives it, and the page
// that covers it. The Export entry is a tenant's export, on the Tenants page.
const PAGE_OF_AREA: Readonly<Record<string, string>> = {
  '': 'overview',
  subjects: 'subjects',
  groups: 'groups',
  roles: 'roles',
  clients: 'clients',
  scopes: 'scopes',
  'registration-tokens': 'registration-tokens',
  flow: 'sign-in-flow',
  keys: 'signing-keys',
  sessions: 'sessions',
  settings: 'settings',
  branding: 'branding',
  email: 'email',
  domains: 'domains',
  export: 'tenants',
  audit: 'audit-trail',
  tenants: 'tenants',
  'system-admins': 'system-administrators',
};

// The tabs of a record, by the file that names them; the tenant's are the
// three its record page opens.
const TAB_LABELS: Readonly<Record<string, TabSource | readonly string[]>> = {
  subjects: { file: 'subjects/services/tabs.ts', map: 'labels: {', root: CONSOLE_PAGES },
  clients: { file: 'clients/services/tabs.ts', map: 'labels: {', root: CONSOLE_PAGES },
  groups: { file: 'groups/services/tabs.ts', map: 'labels: {', root: CONSOLE_PAGES },
  roles: { file: 'roles/services/tabs.ts', map: 'labels: {', root: CONSOLE_PAGES },
  scopes: { file: 'scopes/services/tabs.ts', map: 'labels: {', root: CONSOLE_PAGES },
  tenants: ['General', 'Administrators', 'Export'],
};

const text = (file: string): string => readFileSync(file, 'utf8');
const page = (slug: string): string => text(path.join(PAGES, `${slug}.mdx`));
const bold = (source: string): Set<string> =>
  new Set([...source.matchAll(/\*\*([^*]+)\*\*/gu)].map((match) => match[1] ?? ''));

interface Area {
  readonly path: string;
  readonly label: string;
  readonly capability: string | null;
}

function areas(): Area[] {
  const source = text(path.join(CONSOLE, '../entities/area/services/areas.ts'));
  return [...source.matchAll(/area\(\s*'([^']*)',\s*'([^']*)',\s*(null|'[^']*')/gu)].map(
    (match) => ({
      path: match[1] ?? '',
      label: match[2] ?? '',
      capability: match[3] === 'null' ? null : (match[3] ?? '').slice(1, -1),
    }),
  );
}

interface TabSource {
  file: string;
  map: string;
  root: string;
}

const fromFile = (entry: TabSource | readonly string[]): entry is TabSource =>
  !Array.isArray(entry);

function tabLabels(entry: TabSource | readonly string[]): string[] {
  if (!fromFile(entry)) return [...entry];
  const { file, map, root } = entry;
  const source = text(path.join(root, file));
  const start = source.indexOf(map);
  const body = source.slice(start, source.indexOf('}', start));
  return [...body.matchAll(/:\s*'([^']+)'/gu)].map((match) => match[1] ?? '');
}

// A page for a tab of a feature that is big enough to be a page of its own. It is
// described with the feature it belongs to and checked as the other pages are.
const PAGES_OF_TABS: readonly string[] = ['client-branding'];

const SLUGS = [...Object.values(PAGE_OF_FEATURE), ...PAGES_OF_TABS];

describe('the admin console section', () => {
  it('has a page for every feature directory of the console', () => {
    const directories = [CONSOLE, CONSOLE_PAGES]
      .flatMap((root) => readdirSync(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const known = [
      ...Object.keys(PAGE_OF_FEATURE),
      ...DESCRIBED_BY_THE_TOUR,
      ...DESCRIBED_BY_ITS_PAGES,
    ].sort();
    expect(directories).toEqual(known);
    for (const slug of SLUGS) expect(existsSync(path.join(PAGES, `${slug}.mdx`)), slug).toBe(true);
    expect(existsSync(path.join(PAGES, 'tour.mdx'))).toBe(true);
  });

  it('holds exactly the pages the index lists, and links each from it', () => {
    const found = readdirSync(PAGES)
      .filter((name) => name !== 'index.md')
      .map((name) => name.replace(/\.mdx$/u, ''))
      .sort();
    expect(found).toEqual([...new Set([...SLUGS, 'tour'])].sort());
    const index = text(path.join(PAGES, 'index.md'));
    for (const slug of found) expect(index, slug).toContain(`(./${slug}.mdx)`);
  });

  it('names every menu entry, in bold, on the page that covers it', () => {
    const all = areas();
    expect(all.length).toBeGreaterThanOrEqual(15);
    for (const entry of all) {
      const slug = PAGE_OF_AREA[entry.path];
      expect(slug, `no page for the area at "${entry.path}"`).toBeDefined();
      expect(bold(page(slug ?? '')), `${entry.label} on ${slug ?? ''}`).toContain(entry.label);
    }
    expect(Object.keys(PAGE_OF_AREA).sort()).toEqual(
      [...new Set([...all.map((entry) => entry.path), 'export'])].sort(),
    );
  });

  it('names the capability each area needs, as the console states it', () => {
    for (const entry of areas()) {
      const slug = PAGE_OF_AREA[entry.path] ?? '';
      if (entry.capability === null) continue;
      expect(page(slug), `${entry.label} on ${slug}`).toContain(`\`${entry.capability}\``);
    }
  });

  it('names every tab of a record, by the label the console gives it', () => {
    for (const [feature, entry] of Object.entries(TAB_LABELS)) {
      const labels = tabLabels(entry);
      expect(labels.length, feature).toBeGreaterThanOrEqual(3);
      const quoted = bold(page(PAGE_OF_FEATURE[feature] ?? ''));
      for (const label of labels) expect(quoted, `${label} on ${feature}`).toContain(label);
    }
  });

  it('ends each page of an area with the way to do the same through the API', () => {
    const generated = path.join(CONTENT, 'reference/generated/admin-api');
    for (const slug of SLUGS) {
      const source = page(slug);
      const headings = [...source.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
      expect(headings.at(-1), slug).toBe('Do the same through the API');
      const tail = source.slice(source.lastIndexOf('## Do the same through the API'));
      const targets = [...tail.matchAll(/\]\(\.\.\/reference\/generated\/([^)#]+)\)/gu)].map(
        (match) => match[1] ?? '',
      );
      expect(targets.length, slug).toBeGreaterThan(0);
      for (const target of targets) {
        expect(
          existsSync(path.join(CONTENT, 'reference/generated', target)),
          `${slug}: ${target}`,
        ).toBe(true);
      }
    }
    expect(existsSync(generated)).toBe(true);
  });

  it('gives each page of an area a picture, in a story that says what cannot be undone', () => {
    for (const slug of SLUGS) {
      const source = page(slug);
      expect(source, slug).toMatch(/<ConsoleShot\s/u);
      expect(source, slug).toMatch(/^## (Things|Nothing)/mu);
      expect(source, slug).toMatch(/^## \d\. /mu);
    }
  });

  it('keeps the repository out of what a reader reads', () => {
    for (const slug of [...SLUGS, 'tour']) {
      const prose = page(slug).replace(/^---\n[\s\S]*?\n---\n/u, '');
      expect(prose, slug).not.toMatch(
        /\b(ADR|docs\/|packages\/|apps\/|tests\/|\.test\.ts|Increment|phase P\d|Playwright)/u,
      );
    }
  });

  it('names only commands the command line has, in the tour', () => {
    const registry = text(path.join(REPO, 'apps/server/src/cli/registry.ts'));
    const tour = page('tour');
    const commands = [...tour.matchAll(/`odudu ([a-z-]+)(?: [a-z-]+)?`/gu)].map((m) => m[1] ?? '');
    expect(commands.length).toBeGreaterThanOrEqual(4);
    for (const command of commands) expect(registry, command).toContain(`name: '${command}'`);
  });

  it('calls a command a scheduled pass only when the server schedules it, and run-once what is run once', () => {
    const settings = text(path.join(REPO, 'packages/kernel/src/config-docs.ts'));
    const registry = text(path.join(REPO, 'apps/server/src/cli/registry.ts'));
    const sentences = [page('tour'), text(path.join(CONTENT, 'roadmap.md'))].flatMap((source) =>
      source.split(/(?<=[.:;])\s+/u),
    );
    for (const scheduled of ['reap', 'send-mail', 'send-logouts']) {
      const named = new RegExp(`_ENABLED[\\s\\S]{0,500}odudu ${scheduled}`, 'u');
      expect(named.test(settings.replace(/'\\s*\\+\\s*'/gu, '')), scheduled).toBe(true);
    }
    expect(registry).toMatch(/Rebuild the stored client origins after upgrading/u);
    const once = sentences.filter((sentence) => sentence.includes('odudu client-origins rebuild'));
    expect(once.length).toBeGreaterThan(0);
    for (const sentence of once) expect(sentence, sentence).not.toMatch(/schedul|timer/u);
  });

  it('states the tenant name rule as the contract does', () => {
    const rule = text(path.join(REPO, 'packages/contracts/src/tenant-name.ts'));
    expect(rule).toMatch(/1-63 lowercase letters, digits or hyphens/u);
    expect(rule).toMatch(/must not start or end/u);
    expect(page('tenants')).toMatch(/one to sixty-three lowercase letters, digits or hyphens/u);
    expect(page('tenants')).toMatch(/may not start or end with a hyphen/u);
  });
});
