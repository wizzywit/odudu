import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  explain,
  findings,
  isWork,
  scansOf,
  StatementRecorder,
  type PlanBudget,
  type ScanSummary,
  type Statement,
} from '#/testing/plan-capture';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { COUNT_CAP } from '@odudu/protocol-admin';
import {
  adminIds,
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

async function violations(run: PathRun): Promise<string[]> {
  const out: string[] = [];
  for (const statement of distinct(run)) {
    let plan;
    try {
      plan = await explain(statement.handle === 'owner' ? world.owner : world.app, statement);
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
    for (const finding of findings(plan, budget)) {
      if (run.outputBound === true && finding.rule === 'wide-scan') continue;
      if (EXPORTS.test(run.path)) continue;
      out.push(
        `${run.path}: ${finding.rule} on ${finding.table} (${finding.node}, ${String(finding.rows)} rows ${finding.basis}): ${statement.query.replace(/\s+/gu, ' ').slice(0, 400)}`,
      );
    }
  }
  return out;
}

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
        join(out, 'counts.txt'),
        counts.map((c) => `${String(c.small)} ${String(c.large)} ${c.path}`).join('\n'),
      );
    }
    expect(all).toEqual([]);
  });
});
