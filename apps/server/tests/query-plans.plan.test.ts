import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  explain,
  findings,
  isWork,
  readsOnly,
  scansOf,
  StatementRecorder,
  type ExplainOptions,
  type Finding,
  type PlanBudget,
  type PlanNode,
  type ScanSummary,
  type Statement,
} from '#/testing/plan-capture';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { ADMIN_ROUTES, COUNT_CAP } from '@odudu/protocol-admin';
import {
  adminIds,
  BOUNDED_PAIR,
  adminTokens,
  driveAdmin,
  type QueryCount,
  type ReadSize,
} from '#/testing/plan-admin-drives';
import { driveAccount, driveRequiredActions } from '#/testing/plan-account-drives';
import {
  driveBackground,
  driveGateway,
  driveRepositories,
  retentionRuns,
} from '#/testing/plan-background-drives';
import { unindexedForeignKeys } from '#/testing/plan-catalog';
import { driveAdminWrites } from '#/testing/plan-admin-writes';
import { BRANDING_PATHS, driveBranding } from '#/testing/plan-branding-drives';
import { driveOidc } from '#/testing/plan-oidc-drives';
import { pathLog, type PathRun } from '#/testing/plan-paths';
import { startPlanWorld, type PlanWorld } from '#/testing/plan-world';

const LARGE_TABLE_ROWS = 5_000;
// A page of MAX_LIMIT rows with up to ten rows each of what hangs off it.
const ROWS_PER_READ = 10 * MAX_LIMIT;
// A listing's batched lookups (a page's clients' names, say) are skipped by a
// page whose rows need none, so the two sizes may differ by a few; a query per
// row would differ by the page size.
const BATCHED_LOOKUPS = 2;

const recorder = new StatementRecorder();
const log = pathLog(recorder);
let world: PlanWorld;
let budget: PlanBudget;
let counts: QueryCount[] = [];
let sizes: ReadSize[] = [];
const explained = { searched: 0, generic: 0 };
const inventory: { path: string; area: string; query: string; scans: ScanSummary[] }[] = [];

beforeAll(async () => {
  world = await startPlanWorld({
    owner: { onQueryForTests: recorder.hook('owner') },
    app: { onQueryForTests: recorder.hook('app') },
  });
  const tables = await world.owner.sql<{ name: string }[]>`
    select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.reltuples >= ${LARGE_TABLE_ROWS}`;
  budget = {
    largeTables: new Set(tables.map((t) => t.name)),
    rowsPerRead: ROWS_PER_READ,
    rowsUnderLimit: COUNT_CAP + 1000,
  };
  await driveOidc(world, log.capture);
  await driveBranding(world, log.capture);
  await driveAccount(world, log.capture);
  await driveRequiredActions(world, log.capture);
  const ids = await adminIds(world);
  await driveRepositories(world, world.app.db, ids.subject, log.capture);
  await driveBackground(world, log.capture);
  await driveGateway(world, log.capture);
  log.runs.push(...retentionRuns(world));
  const tokens = await adminTokens(world);
  ({ counts, sizes } = await driveAdmin(world, recorder, log.capture, tokens, ids));
  await driveAdminWrites(world, log.capture, tokens, ids);
}, 600_000);

afterAll(async () => {
  await world.stop();
});

// One statement text is explained once per path, under the plan tenant when
// the path ran for it: a pass that visits every tenant sends the same text
// for each, and the large tenant's plan is the one that can be wrong.
function distinct(run: PathRun): Statement[] {
  const byText = new Map<string, Statement>();
  for (const statement of run.statements.filter(isWork)) {
    const key = `${statement.handle}|${statement.query}`;
    const held = byText.get(key);
    if (
      held === undefined ||
      (held.tenantId !== world.tenantId && statement.tenantId === world.tenantId)
    ) {
      byText.set(key, statement);
    }
  }
  return [...byText.values()];
}

// A whole-tenant export reads the tenant: that is the operation. What holds it
// is the cap on what it will export (EXPORT_COLLECTION_CAP, EXPORT_LINK_CAP,
// AUDIT_EXPORT_CAP), checked by the export tests, so no plan rule applies.
const EXPORTS = /^GET \/admin\/tenants\/[^/]+\/(audit\/)?export$/u;

// A search holds its own collection to two pages of reads: it must stop at the
// page, not read what matches. Judged under a page cost a spinning disk gives, at
// which the planner prices a bitmap of the matches under an ordered scan.
// The audit pair of two common filters whose rows never meet: read by the cheaper
// of the two indexes and filtered by the other, so it reads a share of the table
// however small its page. It is not held to a read budget but to the statement
// timeout, which the audit describe below asserts was set.
const BOUNDED_BY_TIMEOUT = new RegExp(
  `/audit(?:/count|/export)?\\?${BOUNDED_PAIR.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
  'u',
);

const SEARCHED =
  /^GET \/admin\/tenants\/[^/]+\/(clients|roles|groups|scopes|subjects|tenants)\?(name|client_id|username|email|given_name|family_name|display_name)=/u;
const LISTED_TABLES: Record<string, readonly string[]> = {
  clients: ['clients', 'client_oidc_config'],
  roles: ['roles'],
  groups: ['groups'],
  scopes: ['client_scopes'],
  subjects: ['users', 'subjects'],
  tenants: ['tenants'],
};
const TWO_PAGES = 2 * (MAX_LIMIT + 1);
const SPINNING_DISK = ['random_page_cost = 4'];

function line(run: PathRun, finding: Finding, statement: Statement, note = ''): string {
  return `${run.path}: ${finding.rule} on ${finding.table} (${finding.node}, ${String(finding.rows)} rows ${finding.basis}${note}): ${statement.query.replace(/\s+/gu, ' ').slice(0, 400)}`;
}

async function planned(statement: Statement, options?: ExplainOptions): Promise<PlanNode> {
  return explain(statement.handle === 'owner' ? world.owner : world.app, statement, options);
}

async function violations(run: PathRun): Promise<string[]> {
  const out: string[] = [];
  const searched = SEARCHED.exec(run.path);
  for (const statement of distinct(run)) {
    let plan: PlanNode;
    try {
      plan = await planned(statement);
    } catch (error) {
      throw new Error(`${run.path}: could not explain ${statement.query.slice(0, 300)}`, {
        cause: error,
      });
    }
    inventory.push({
      path: run.path,
      area: run.area,
      query: statement.query.replace(/\s+/gu, ' ').slice(0, 220),
      scans: scansOf(plan),
    });
    if (EXPORTS.test(run.path) || BOUNDED_BY_TIMEOUT.test(run.path)) continue;
    for (const finding of findings(plan, budget)) {
      if (run.outputBound === true && finding.rule === 'wide-scan') continue;
      out.push(line(run, finding, statement));
    }
    const listed = searched?.[1] === undefined ? [] : (LISTED_TABLES[searched[1]] ?? []);
    if (listed.length > 0 && readsOnly(statement)) {
      explained.searched += 1;
      const pessimistic = await planned(statement, { settings: SPINNING_DISK });
      for (const finding of findings(pessimistic, { ...budget, rowsPerRead: TWO_PAGES })) {
        if (listed.includes(finding.table)) {
          out.push(line(run, finding, statement, ', a search holds to two pages'));
        }
      }
    }
    // The plan a prepared statement switches to after a few runs is made without
    // the values: it must not be a scan of a large table either.
    if (run.area === 'admin' && readsOnly(statement)) {
      explained.generic += 1;
      const generic = await planned(statement, { generic: true });
      for (const finding of findings(generic, budget)) {
        if (finding.rule === 'seq-scan') out.push(line(run, finding, statement, ', generic plan'));
      }
    }
  }
  return out;
}

function workOf(path: string): Statement[] {
  const run = log.runs.find((candidate) => candidate.path === path);
  if (run === undefined) throw new Error(`no run named ${path}`);
  return run.statements.filter(isWork);
}

const themeReads = (statements: Statement[]): number =>
  statements.filter((statement) => statement.query.includes('theme_versions')).length;

describe('a themed page render', () => {
  it("sends the cached render's statements plus at most one theme read on a miss", () => {
    const baseline = workOf(BRANDING_PATHS.cachedHit);
    const miss = workOf(BRANDING_PATHS.themedMiss);
    expect(themeReads(baseline)).toBe(0);
    expect(themeReads(miss)).toBe(1);
    expect(miss.length).toBeLessThanOrEqual(baseline.length + 1);
  });

  it("sends exactly the cached render's statements on a hit", () => {
    const baseline = workOf(BRANDING_PATHS.cachedHit);
    const hit = workOf(BRANDING_PATHS.themedHit);
    expect(themeReads(hit)).toBe(0);
    expect(hit.length).toBe(baseline.length);
  });
});

const overrideReads = (statements: Statement[]): number =>
  statements.filter((statement) => statement.query.includes('"message_overrides"')).length;

describe('a page render and the tenant’s message overrides', () => {
  it('reads a locale’s overrides once on a miss, and none on a hit', () => {
    const baseline = workOf(BRANDING_PATHS.cachedHit);
    const miss = workOf(BRANDING_PATHS.overridesMiss);
    expect(overrideReads(baseline)).toBe(0);
    expect(overrideReads(miss)).toBe(1);
    expect(miss.length).toBe(baseline.length + 1);
  });

  it('reads them by the primary key, even where scanning is allowed to lose', async () => {
    const read = workOf(BRANDING_PATHS.overridesMiss).find((statement) =>
      statement.query.includes('"message_overrides"'),
    );
    expect(read).toBeDefined();
    if (read === undefined) return;
    const plan = await planned(read, { settings: ['enable_seqscan = off'] });
    const own = scansOf(plan).filter((scan) => scan.relation === 'message_overrides');
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((scan) => scan.node === 'Seq Scan')).toEqual([]);
  });
});

// What the registration form costs with a cached theme and no return_to: a
// statement added to every registration path moves this number.
const PLAIN_REGISTRATION_STATEMENTS = 1;

const tenantLookups = (statements: Statement[]): number =>
  statements.filter((statement) => statement.query.includes('"tenants"."name"')).length;
const clientLookups = (statements: Statement[]): number =>
  statements.filter(
    (statement) =>
      statement.query.includes('from "clients"') && statement.query.includes('"client_id" = $'),
  ).length;

describe('the pages a tenant theme reaches without a parked request', () => {
  it('looks the tenant up once for a logout page', () => {
    expect(tenantLookups(workOf(BRANDING_PATHS.logoutPage))).toBe(1);
  });

  it('checks a return_to client with one indexed lookup, found or not', () => {
    const plain = workOf(BRANDING_PATHS.registrationPlain);
    expect(plain.length).toBe(PLAIN_REGISTRATION_STATEMENTS);
    const garbage = workOf(BRANDING_PATHS.registrationGarbage);
    const client = workOf(BRANDING_PATHS.registrationClient);
    const miss = workOf(BRANDING_PATHS.registrationClientMiss);
    expect(clientLookups(garbage)).toBe(clientLookups(plain) + 1);
    expect(garbage.length).toBe(plain.length + 1);
    expect(client.length).toBe(garbage.length);
    expect(themeReads(client)).toBe(0);
    expect(miss.length).toBe(client.length + 1);
    expect(themeReads(miss)).toBe(1);
  });
});

// A brand file is a tenant lookup and one read of its own, nothing for a name
// that cannot be a hash, and the read has a plan that uses the index even
// where a table is small enough for the planner to prefer scanning it.
describe('a brand file', () => {
  const bodyReads = (statements: Statement[]): number =>
    statements.filter((s) => s.query.includes('"theme_versions"') && s.query.includes('"body"'))
      .length;
  const byteReads = (statements: Statement[]): number =>
    statements.filter((s) => s.query.includes('"theme_assets"."bytes"')).length;

  it('costs a tenant lookup and one read, and nothing for a malformed name', () => {
    expect(workOf(BRANDING_PATHS.brandNothing)).toEqual([]);
    for (const path of [BRANDING_PATHS.brandImage, BRANDING_PATHS.brandStylesheet]) {
      const work = workOf(path);
      expect(tenantLookups(work), path).toBe(1);
      expect(work.length, path).toBe(2);
    }
  });

  it('reads no body for a wrong stylesheet hash once the versions are remembered', () => {
    const cold = workOf(BRANDING_PATHS.brandStylesheetCold);
    expect(bodyReads(cold)).toBe(1);
    const remembered = workOf(BRANDING_PATHS.brandStylesheetRandom);
    expect(tenantLookups(remembered)).toBe(1);
    expect(remembered.length).toBe(2);
    expect(bodyReads(remembered)).toBe(0);
    expect(bodyReads(workOf(BRANDING_PATHS.brandStylesheet))).toBe(0);
  });

  it('answers a matching conditional request for an image without its bytes', () => {
    const revalidate = workOf(BRANDING_PATHS.brandImageRevalidate);
    expect(revalidate.length).toBe(2);
    expect(byteReads(revalidate)).toBe(0);
    expect(byteReads(workOf(BRANDING_PATHS.brandImage))).toBe(1);
  });

  it('reads an image and the stylesheet layers by index, even where scanning is allowed to lose', async () => {
    const image = workOf(BRANDING_PATHS.brandImage).find((s) => s.query.includes('"theme_assets"'));
    const layers = workOf(BRANDING_PATHS.brandStylesheetRandom).find((s) =>
      s.query.includes('"theme_versions"'),
    );
    expect(image).toBeDefined();
    expect(layers).toBeDefined();
    for (const [statement, table] of [
      [image, 'theme_assets'],
      [layers, 'theme_versions'],
    ] as const) {
      if (statement === undefined) continue;
      const plan = await planned(statement, { settings: ['enable_seqscan = off'] });
      const own = scansOf(plan).filter((scan) => scan.relation === table);
      expect(own.length, table).toBeGreaterThan(0);
      expect(
        own.filter((scan) => scan.node === 'Seq Scan'),
        table,
      ).toEqual([]);
    }
  });
});

describe('every foreign key', () => {
  it('is found by an index, so a parent row can be deleted without reading its children whole', async () => {
    expect(await unindexedForeignKeys(world.owner)).toEqual([]);
  });
});

describe('every collection', () => {
  it('answers with at most MAX_LIMIT rows', () => {
    expect(sizes.filter((size) => size.rows > MAX_LIMIT)).toEqual([]);
  });
});

describe('every list', () => {
  it('sends the same statements for one row as for MAX_LIMIT', () => {
    expect(counts.filter((c) => c.large - c.small > BATCHED_LOOKUPS)).toEqual([]);
  });
});

describe('every statement a path sends', () => {
  it('reports the paths', () => {
    expect(log.runs.length).toBeGreaterThan(0);
  });
  it('is planned without a scan of a large table', async () => {
    const all: string[] = [];
    for (const run of log.runs) all.push(...(await violations(run)));
    const out = process.env.QUERY_PLANS_OUT;
    if (out !== undefined) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'inventory.json'), JSON.stringify(inventory, null, 1));
      writeFileSync(
        join(out, 'summary.txt'),
        `seed ${String(world.volumeSeconds)} s, ${String(log.runs.length)} paths, ${String(inventory.length)} statements, ${String(explained.searched)} held to two pages, ${String(explained.generic)} planned generically\n`,
      );
      writeFileSync(
        join(out, 'counts.txt'),
        counts.map((c) => `${String(c.small)} ${String(c.large)} ${c.path}`).join('\n'),
      );
    }
    expect(all).toEqual([]);
  }, 300_000);
});

// The audit filters the console offers: each reads audit_events in the listing's
// own order by an index, never by sorting or scanning the table, and the pair
// no index can serve runs under the statement timeout.
const AUDIT_FILTERED = /\/audit(?:\/count|\/export)?\?/u;

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...node.children.flatMap(planNodes)];
}

describe('the audit trail narrowed by a filter', () => {
  const runs = (): PathRun[] => log.runs.filter((run) => AUDIT_FILTERED.test(run.path));

  it('is driven for every filter, alone and in the pairs the console offers', () => {
    const paths = runs().map((run) => run.path);
    for (const filter of [
      'resource_type=subject',
      'resource_type=signing_key',
      'from=',
      'event_type=token',
      'actor_subject_id=',
      'outcome=',
      'resource_type=subject&resource_id=',
      'resource_type=subject&outcome=allowed',
      'actor_subject_id=',
    ]) {
      expect(
        paths.some((path) => path.includes(filter)),
        filter,
      ).toBe(true);
    }
    expect(paths.some((path) => BOUNDED_BY_TIMEOUT.test(path))).toBe(true);
  });

  it('is read in the listing order by an index, with no Sort and no Seq Scan, unless held to the timeout', async () => {
    const offending: string[] = [];
    for (const run of runs().filter((each) => !BOUNDED_BY_TIMEOUT.test(each.path))) {
      for (const statement of distinct(run)) {
        if (!statement.query.includes('"audit_events"') || !readsOnly(statement)) continue;
        const nodes = planNodes(await planned(statement));
        for (const node of nodes) {
          const onAudit = node.relationName === 'audit_events' || node.nodeType === 'Sort';
          if (onAudit && (node.nodeType === 'Sort' || node.nodeType === 'Seq Scan')) {
            offending.push(`${run.path}: ${node.nodeType}`);
          }
        }
      }
    }
    expect(offending).toEqual([]);
  }, 300_000);

  it('runs the pair no index serves under the statement timeout', () => {
    const bounded = runs().filter((run) => BOUNDED_BY_TIMEOUT.test(run.path));
    expect(bounded.length).toBeGreaterThanOrEqual(3);
    for (const run of bounded) {
      expect(
        run.statements.some((statement) =>
          statement.query.includes("set_config('statement_timeout'"),
        ),
        run.path,
      ).toBe(true);
      expect(run.status ?? 200, run.path).not.toBe(500);
    }
  });
});

// Routes the drives do not reach, each with the reason a plan over this volume
// says nothing more about it. Every other route of the admin API is driven.
const NOT_DRIVEN: Readonly<Record<string, string>> = {
  'POST /admin/tenants/:tenant/smtp/test':
    'reads the tenant\u2019s one settings row and opens a socket to the SMTP host: no query depends on the volume',
};

function routePattern(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/?]+' : part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))
    .join('/');
  return new RegExp(`^${source}$`, 'u');
}

describe('every admin route', () => {
  it('is driven by the check to a 2xx, or named as not driven with a reason', () => {
    const answered = log.runs
      .filter((run) => run.area === 'admin' && run.status !== undefined)
      .map((run) => {
        const [method = '', rest = ''] = run.path.split(' ', 2);
        const url = (run.path.slice(method.length + 1).split(' (')[0] ?? rest).split('?')[0] ?? '';
        return { method, url, status: run.status ?? 0 };
      });
    const driven = answered.filter((run) => run.status < 300);
    const missing = ADMIN_ROUTES.filter((route) => {
      const key = `${route.method} ${route.pattern}`;
      if (NOT_DRIVEN[key] !== undefined) return false;
      const re = routePattern(route.pattern);
      return !driven.some((run) => run.method === route.method && re.test(run.url));
    }).map((route) => {
      const re = routePattern(route.pattern);
      const seen = answered
        .filter((run) => run.method === route.method && re.test(run.url))
        .map((run) => String(run.status));
      return `${route.method} ${route.pattern} answered ${seen.join(', ') || 'nothing'}`;
    });
    expect(missing).toEqual([]);
    expect(
      Object.keys(NOT_DRIVEN).filter(
        (key) => !ADMIN_ROUTES.some((r) => `${r.method} ${r.pattern}` === key),
      ),
    ).toEqual([]);
  });
});
