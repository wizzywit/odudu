import { type DatabaseHandle } from '@odudu/db';

export type HandleName = 'app' | 'owner';

export interface Statement {
  readonly handle: HandleName;
  // The tenant the statement's transaction was bound to when it was sent;
  // undefined outside one.
  readonly tenantId: string | undefined;
  readonly query: string;
  readonly parameters: readonly unknown[];
  // The parameter type OIDs the driver declared; 0 where it left one to infer.
  readonly types?: readonly number[];
}

const BOOLEAN_OID = 16;
const TRANSACTION_END = /^\s*(begin|commit|rollback)\b/iu;
const TENANT_BINDING = "set_config('app.tenant_id'";

// Follows each pooled connection's transaction-local tenant binding from
// the statements it sees, so a statement can be explained under the tenant
// it ran for. Requests are driven one at a time, which is what makes the
// order of what it sees the order the connections used.
export class StatementRecorder {
  private readonly bound = new Map<string, string | undefined>();
  private sink: Statement[] | undefined;

  hook(handle: HandleName) {
    return (
      query: string,
      parameters: readonly unknown[],
      connection: number,
      types: readonly number[],
    ): void => {
      const key = `${handle}:${String(connection)}`;
      if (TRANSACTION_END.test(query)) {
        this.bound.delete(key);
        return;
      }
      if (query.includes(TENANT_BINDING)) {
        const tenant: unknown = parameters[0];
        this.bound.set(key, typeof tenant === 'string' ? tenant : undefined);
      }
      this.sink?.push({ handle, tenantId: this.bound.get(key), query, parameters, types });
    };
  }

  async record<T>(run: () => Promise<T>): Promise<{ result: T; statements: Statement[] }> {
    const statements: Statement[] = [];
    this.sink = statements;
    try {
      const result = await run();
      return { result, statements };
    } finally {
      this.sink = undefined;
    }
  }
}

// What a request's own work is: not the tenant binding, the driver's type
// introspection, or the transaction and savepoint bookkeeping around it.
export function isWork(statement: Statement): boolean {
  const query = statement.query.trimStart().toLowerCase();
  if (query.includes('set_config(') || query.includes('pg_catalog.')) return false;
  return /^(select|with|insert|update|delete)\b/u.test(query);
}

export interface PlanNode {
  readonly nodeType: string;
  readonly relationName: string | undefined;
  readonly indexName: string | undefined;
  readonly indexCond: string | undefined;
  readonly filter: string | undefined;
  readonly planRows: number;
  // Present when the plan was run: the rows the node produced and the rows
  // it looked at and dropped, each over every loop.
  readonly actualRows: number | undefined;
  readonly removedRows: number;
  readonly children: readonly PlanNode[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function planNode(value: unknown): PlanNode {
  if (typeof value !== 'object' || value === null) throw new Error('plan node is not an object');
  const node = value as Record<string, unknown>;
  const nodeType = node['Node Type'];
  const rows = node['Plan Rows'];
  if (typeof nodeType !== 'string' || typeof rows !== 'number') {
    throw new Error('plan node has no Node Type or Plan Rows');
  }
  const plans = node.Plans;
  const loops = numberOf(node['Actual Loops']);
  const ran = typeof node['Actual Rows'] === 'number';
  return {
    nodeType,
    relationName: optionalString(node['Relation Name']),
    indexName: optionalString(node['Index Name']),
    indexCond: optionalString(node['Index Cond']),
    filter: optionalString(node.Filter),
    planRows: rows,
    actualRows: ran ? numberOf(node['Actual Rows']) * loops : undefined,
    removedRows:
      (numberOf(node['Rows Removed by Filter']) + numberOf(node['Rows Removed by Index Recheck'])) *
      loops,
    children: Array.isArray(plans) ? plans.map(planNode) : [],
  };
}

function rootPlan(explained: unknown): PlanNode {
  const document: unknown = typeof explained === 'string' ? JSON.parse(explained) : explained;
  if (!Array.isArray(document)) throw new Error('EXPLAIN (FORMAT JSON) returned no array');
  const first: unknown = document[0];
  if (typeof first !== 'object' || first === null || !('Plan' in first)) {
    throw new Error('EXPLAIN (FORMAT JSON) returned no Plan');
  }
  return planNode(first.Plan);
}

// What a statement that only reads can be run as, so the plan can be held to
// the rows it reads and not to what the planner guessed it would.
export function readsOnly(statement: Statement): boolean {
  const query = statement.query.trimStart().toLowerCase();
  return /^(select|with)\b/u.test(query) && !/\b(insert|update|delete)\b/u.test(query);
}

class Rolled extends Error {
  readonly plan: unknown;
  constructor(plan: unknown) {
    super('rolled back');
    this.plan = plan;
  }
}

export async function explain(handle: DatabaseHandle, statement: Statement): Promise<PlanNode> {
  const options = readsOnly(statement) ? 'ANALYZE, TIMING OFF, FORMAT JSON' : 'FORMAT JSON';
  try {
    await handle.sql.begin(async (tx) => {
      if (statement.tenantId !== undefined) {
        await tx`select set_config('app.tenant_id', ${statement.tenantId}, true)`;
      }
      // Typed as the driver typed them when the statement ran. The hook sees
      // a value after the driver has serialized it, and a boolean is then
      // the text 't' or 'f', which the driver would serialize to 'f' again.
      const parameters = statement.parameters.map((value, index) => {
        const oid = statement.types?.[index] ?? 0;
        if (oid === BOOLEAN_OID) return tx.typed(value === 't', oid);
        return oid === 0 ? value : tx.typed(value, oid);
      }) as Parameters<typeof tx.unsafe>[1];
      const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
        `EXPLAIN (${options}) ${statement.query}`,
        parameters,
      );
      throw new Rolled(rows[0]?.['QUERY PLAN']);
    });
  } catch (error) {
    if (error instanceof Rolled) return rootPlan(error.plan);
    throw error;
  }
  throw new Error('the explain did not answer');
}

export interface Finding {
  readonly rule: 'seq-scan' | 'wide-scan' | 'sort';
  readonly table: string;
  readonly node: string;
  readonly rows: number;
  readonly basis: 'read' | 'estimated';
}

const SCANS = new Set([
  'Seq Scan',
  'Index Scan',
  'Index Only Scan',
  'Bitmap Heap Scan',
  'Bitmap Index Scan',
]);
// Nodes that read their whole input before they hand on a row, so a Limit
// above them stops nothing beneath them.
const DRAINS = new Set(['Sort', 'Aggregate', 'Hash', 'WindowAgg', 'SetOp', 'Unique']);

export interface PlanBudget {
  // Tables whose rows at this volume make reading them whole a defect.
  readonly largeTables: ReadonlySet<string>;
  // The most rows a node may read when nothing but its own condition bounds
  // it: above this it is reading a tenant's table, not finding a record.
  readonly rowsPerRead: number;
  // What a scan under a LIMIT may return before it stops: the model's own
  // cap on a count, which stops at a stated number of rows however many exist.
  readonly rowsUnderLimit: number;
}

function readBy(node: PlanNode): number | undefined {
  return node.actualRows === undefined ? undefined : node.actualRows + node.removedRows;
}

// The plan is held to the rows its scans and sorts read when it was run, and
// to what the planner expected of them when it could not be (a statement that
// writes). A scan of a large table in sequence is a defect however many rows
// it kept, except under a LIMIT that stopped it inside the budget.
export function findings(plan: PlanNode, budget: PlanBudget): Finding[] {
  const found: Finding[] = [];

  // `reached` is set beneath the recursive term of a closure when only
  // estimates exist: the planner estimates it at ten times its seed whatever
  // the data holds, and what it reads is what the one starting row reaches.
  function walk(
    node: PlanNode,
    limited: boolean,
    relation: string | undefined,
    reached: boolean,
  ): void {
    const table = node.relationName ?? relation;
    const large = table !== undefined && budget.largeTables.has(table);
    const read = readBy(node);
    const scan = SCANS.has(node.nodeType) && node.nodeType !== 'Bitmap Index Scan';
    if (large && node.nodeType === 'Seq Scan') {
      const stopped = limited && read !== undefined && read <= budget.rowsUnderLimit;
      if (!stopped) {
        found.push({
          rule: 'seq-scan',
          table,
          node: node.nodeType,
          rows: read ?? node.planRows,
          basis: read === undefined ? 'estimated' : 'read',
        });
      }
    } else if (large && scan) {
      const wide =
        read === undefined
          ? !limited && !reached && node.planRows > budget.rowsPerRead
          : limited
            ? read - node.removedRows > budget.rowsUnderLimit ||
              node.removedRows > budget.rowsPerRead
            : read > budget.rowsPerRead;
      if (wide) {
        found.push({
          rule: 'wide-scan',
          table,
          node: `${node.nodeType}${node.indexName === undefined ? '' : ` on ${node.indexName}`}`,
          rows: read ?? node.planRows,
          basis: read === undefined ? 'estimated' : 'read',
        });
      }
    }
    if (node.nodeType === 'Sort') {
      const input = node.children[0];
      const estimated = reached || readsClosure(node) ? 0 : node.planRows;
      const sorted = input?.actualRows ?? estimated;
      if (sorted > budget.rowsPerRead) {
        found.push({
          rule: 'sort',
          table: sortedTable(node) ?? 'a join',
          node: node.nodeType,
          rows: sorted,
          basis: input?.actualRows === undefined ? 'estimated' : 'read',
        });
      }
    }
    const childLimited =
      node.nodeType === 'Limit' ? true : DRAINS.has(node.nodeType) ? false : limited;
    node.children.forEach((child, index) => {
      const recursiveTerm = node.nodeType === 'Recursive Union' && index > 0;
      walk(child, childLimited, table, reached || recursiveTerm);
    });
  }

  walk(plan, false, undefined, false);
  return found;
}

// A sort of a recursive closure sorts what the closure reaches, which is its
// answer, and its estimate is the planner's ten-times guess.
function readsClosure(node: PlanNode): boolean {
  return node.nodeType === 'CTE Scan' || node.children.some(readsClosure);
}

function sortedTable(node: PlanNode): string | undefined {
  for (const child of node.children) {
    if (child.relationName !== undefined) return child.relationName;
    const deeper = sortedTable(child);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

export interface ScanSummary {
  readonly node: string;
  readonly relation: string | undefined;
  readonly index: string | undefined;
  readonly rows: number;
}

// Every scan a plan makes, with the rows it read when the plan was run and
// those the planner expected when it was not, for the record of each path.
export function scansOf(plan: PlanNode): ScanSummary[] {
  const found: ScanSummary[] = [];
  const visit = (node: PlanNode, relation: string | undefined): void => {
    const table = node.relationName ?? relation;
    if (SCANS.has(node.nodeType) && node.nodeType !== 'Bitmap Index Scan') {
      found.push({
        node: node.nodeType,
        relation: table,
        index: node.indexName,
        rows: readBy(node) ?? node.planRows,
      });
    }
    for (const child of node.children) visit(child, table);
  };
  visit(plan, undefined);
  return found;
}
