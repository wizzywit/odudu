import { describe, expect, it } from 'vitest';
import { tierOfTool } from '../../packages/assistant/src/service/approval-card.js';
import { assistantTools } from '../../packages/assistant/src/service/tool-set.js';
import {
  HUMAN_ONLY,
  NOT_TOOL_KINDS,
  NOT_TOOLS,
  TOOLS,
  UNPLACED_WRITES,
} from '../../packages/mcp/src/service/catalogue.js';
import {
  ADMIN_ROUTES,
  AGENT_DENIED_READS,
  AGENT_WRITE_ROUTES,
  ASSISTANT_WRITE_ROUTES,
  INSTANCE_READS,
} from '../../packages/protocol-admin/src/index.js';
import { backticked, loadSource, tableWithHeadings } from './markdown.js';

// The class of every admin route is a durable document, not a table in a spec
// that is archived with its phase. This holds the document to the route table
// and to the tool catalogue in both directions, so a route that moves to a tool,
// or a new route, fails here until its class is written down.
const DOC = 'docs/protocols/mcp-route-classes.md';
const TENANT = '/admin/tenants/:tenant';
const CLASSES = ['R', 'RS', 'W1', 'W2', 'C', 'D', 'I', 'N'] as const;

// What a withheld route's kind says its class is.
const CLASS_OF_KIND: Record<string, string> = {
  denied: 'RS',
  sensitive: 'RS',
  'not-useful': 'N',
  content: 'W1',
  'access-changing': 'W2',
  credential: 'C',
  destructive: 'D',
};
const CLASS_WORD: Record<string, RegExp> = {
  'access-changing': /^Access-changing/u,
  credential: /^Credential/u,
  destructive: /^Destructive/u,
};

interface Row {
  readonly n: number;
  readonly key: string;
  readonly capability: string;
  readonly cls: string;
  readonly tool: string | undefined;
  readonly placement: string;
  readonly assistant: string;
}

const document = loadSource(DOC);
const routeTable = tableWithHeadings(document, [
  '#',
  'Route',
  'Capability',
  'Class',
  'MCP tool',
  'Placement',
  'Assistant',
  'Console screen',
  'Notes',
]);

function keyOf(cell: string): string {
  const [text = ''] = backticked(cell);
  const [method = '', ...rest] = text.split(' ');
  return `${method} ${rest.join(' ').replace(/^~/u, TENANT)}`;
}

const ROWS: readonly Row[] = routeTable.rows.map((cells) => ({
  n: Number(cells[0]),
  key: keyOf(cells[1] ?? ''),
  capability: cells[2] ?? '',
  cls: cells[3] ?? '',
  tool: backticked(cells[4] ?? '')[0],
  placement: cells[5] ?? '',
  assistant: cells[6] ?? '',
}));

const ROUTE_KEYS = ADMIN_ROUTES.map((route) => `${route.method} ${route.pattern}`);
const TOOL_BY_ROUTE = new Map(TOOLS.map((tool) => [tool.routeKey, tool.name]));
const rowOf = (key: string): Row | undefined => ROWS.find((row) => row.key === key);

// What the console assistant does with a route, from the registries: a write is
// a tool of its tier, a human-only route with its group, or not yet a tool; a
// read is offered, or withheld with the kind of the withheld route.
const OFFERED_READS = new Set(assistantTools(TOOLS).map((tool) => tool.routeKey));
const HUMAN_ONLY_GROUP_OF = new Map(
  HUMAN_ONLY.flatMap((entry) => entry.routes.map((route) => [route, entry.group] as const)),
);
function assistantCell(key: string): string {
  if (key.startsWith('GET ')) {
    if (OFFERED_READS.has(key)) return 'yes';
    return TOOL_BY_ROUTE.has(key) ? 'no: own record' : `no: ${NOT_TOOL_KINDS[key] ?? 'unplaced'}`;
  }
  const tool = TOOLS.find((candidate) => candidate.routeKey === key);
  if (tool !== undefined) return `tier ${tierOfTool(tool.name)}`;
  const group = HUMAN_ONLY_GROUP_OF.get(key);
  if (group !== undefined) return `human-only: ${group}`;
  return UNPLACED_WRITES.includes(key) ? 'not yet' : 'unplaced';
}

describe('the route classes document against the admin routes', () => {
  it('has one row for every admin route, in order, and says how many', () => {
    expect(ROWS.map((row) => row.n)).toEqual(ROWS.map((_, i) => i + 1));
    expect(ROWS.map((row) => row.key).sort()).toEqual([...ROUTE_KEYS].sort());
    expect(new Set(ROWS.map((row) => row.key)).size).toBe(ROWS.length);
    expect(document.lines.join('\n')).toContain(`**${String(ADMIN_ROUTES.length)} routes**`);
  });

  it('names no route that does not exist', () => {
    expect(ROWS.filter((row) => !ROUTE_KEYS.includes(row.key)).map((row) => row.key)).toEqual([]);
  });

  it('names the capability each route requires', () => {
    for (const route of ADMIN_ROUTES) {
      const row = rowOf(`${route.method} ${route.pattern}`);
      const also = route.alsoAdmits ?? [];
      const expected = `${route.capability ?? 'none'}${also.length === 0 ? '' : ` (+${also.join(', ')})`}`;
      expect(row?.capability, route.pattern).toBe(expected);
    }
  });

  it('gives every row one class and one placement of the allowed few', () => {
    for (const row of ROWS) {
      expect(CLASSES, row.key).toContain(row.cls);
      expect(['this phase', 'P5b', 'never'], row.key).toContain(row.placement);
    }
  });

  it('prints class counts that are the table’s', () => {
    const counts = tableWithHeadings(document, ['Class', 'Routes']);
    const printed = Object.fromEntries(counts.rows.map(([cls = '', n = '']) => [cls, Number(n)]));
    const counted = Object.fromEntries(
      CLASSES.map((cls) => [cls, ROWS.filter((row) => row.cls === cls).length]),
    );
    expect(printed).toEqual(counted);
    expect(Object.values(counted).reduce((sum, n) => sum + n, 0)).toBe(ADMIN_ROUTES.length);
  });
});

describe('the route classes document against the tool catalogue', () => {
  it('gives each withheld route the class its kind names', () => {
    for (const [key, kind] of Object.entries(NOT_TOOL_KINDS)) {
      expect(rowOf(key)?.cls, `${key} (${kind})`).toBe(CLASS_OF_KIND[kind]);
    }
  });

  it('has no tool of audience all for any access-changing, credential or destructive route', () => {
    const everyAgent = new Set(
      TOOLS.filter((tool) => tool.audience !== 'assistant').map((tool) => tool.routeKey),
    );
    for (const row of ROWS.filter((r) => ['W2', 'C', 'D'].includes(r.cls))) {
      expect(everyAgent.has(row.key), row.key).toBe(false);
      expect(row.placement, row.key).toBe('P5b');
      expect(row.tool === undefined || row.assistant.startsWith('tier '), row.key).toBe(true);
    }
  });

  it('says in the Assistant column what the registries say of every route', () => {
    for (const row of ROWS) expect(row.assistant, row.key).toBe(assistantCell(row.key));
  });

  it('keeps the routes only the assistant’s door admits out of the shared allowlist', () => {
    const shared = new Set(AGENT_WRITE_ROUTES.map((entry) => `${entry.method} ${entry.pattern}`));
    for (const entry of ASSISTANT_WRITE_ROUTES) {
      expect(shared.has(`${entry.method} ${entry.pattern}`), entry.pattern).toBe(false);
    }
  });

  it('names the tool that serves a route, in a row of a class a tool may serve', () => {
    for (const [key, name] of TOOL_BY_ROUTE) {
      const row = rowOf(key);
      const forEveryAgent = TOOLS.find((tool) => tool.name === name)?.audience !== 'assistant';
      if (forEveryAgent) {
        expect(['R', 'W1', 'I'], `${key} is served by ${name}`).toContain(row?.cls);
        expect(NOT_TOOLS, key).not.toHaveProperty([key]);
      }
      expect(row?.tool, key).toBe(name);
      expect(row?.placement, key).toBe('this phase');
    }
  });

  it('names a tool in every row of class R and W1 that has one, and none in the rest', () => {
    for (const row of ROWS) {
      const serves =
        ['R', 'W1'].includes(row.cls) || (row.cls === 'I' && row.key.startsWith('GET'));
      if (!(row.key in NOT_TOOLS) && !serves) expect(row.tool, row.key).toBeUndefined();
      if (row.cls === 'W1' && TOOL_BY_ROUTE.has(row.key)) {
        expect(row.tool, row.key).toBe(TOOL_BY_ROUTE.get(row.key));
      }
    }
  });

  it('marks a tool as planned exactly when the catalogue does not have it yet', () => {
    for (const [, cells] of routeTable.rows.entries()) {
      const name = backticked(cells[4] ?? '')[0];
      if (name === undefined) continue;
      const planned = (cells[4] ?? '').includes('(planned)');
      expect(planned, `${name} in row ${cells[0] ?? ''}`).toBe(!TOOLS.some((t) => t.name === name));
    }
  });

  it('says how many W1 routes have a tool today, as the catalogue has them', () => {
    const today = TOOLS.filter((tool) => tool.access === 'write').length;
    expect(document.lines.join('\n')).toContain(`**${String(today)} of them have a tool today**`);
  });

  it('says that a write that is no amendment is admitted to a token the MCP endpoint signed, and why', () => {
    const text = document.lines.join('\n');
    expect(text).toContain('agentWriteNeedsEndpoint');
    const start = text.indexOf('**Who may add or remove.**');
    expect(start).toBeGreaterThan(-1);
    const paragraph = text.slice(start, text.indexOf('\n\n', start));
    for (const tool of TOOLS.filter(
      (t) => t.access === 'write' && !t.routeKey.startsWith('PATCH '),
    )) {
      expect(paragraph, tool.name).toContain(`\`${tool.name}\``);
    }
    expect(paragraph).toMatch(/service account/u);
  });

  it('lists a tool once, and lists every tool that exists', () => {
    const named = ROWS.flatMap((row) => (row.tool === undefined ? [] : [row.tool]));
    expect(new Set(named).size).toBe(named.length);
    for (const tool of TOOLS) expect(named, tool.name).toContain(tool.name);
  });

  it('classes the reads the door refuses as RS and the instance reads as I', () => {
    for (const key of AGENT_DENIED_READS) expect(rowOf(key)?.cls, key).toBe('RS');
    for (const key of INSTANCE_READS) expect(rowOf(key)?.cls, key).toBe('I');
  });

  it('classes every route an agent may write as W1', () => {
    for (const entry of AGENT_WRITE_ROUTES) {
      expect(rowOf(`${entry.method} ${entry.pattern}`)?.cls, entry.pattern).toBe('W1');
    }
  });

  it('writes the class into the reason of every withheld write, with no phase named', () => {
    for (const [key, kind] of Object.entries(NOT_TOOL_KINDS)) {
      const word = CLASS_WORD[kind];
      if (word !== undefined) expect(NOT_TOOLS[key], key).toMatch(word);
      expect(NOT_TOOLS[key], key).not.toMatch(/\bP\d/u);
    }
  });
});

describe('the field table of the mixed routes', () => {
  const fields = tableWithHeadings(document, [
    'Route',
    'W1 (classed agent-writable)',
    'Admitted by the door now',
    'W2 or refused, with the reason',
  ]);

  const doorKeys = new Set(AGENT_WRITE_ROUTES.map((entry) => `${entry.method} ${entry.pattern}`));

  it('names, for each route an agent may write, every field the door admits', () => {
    for (const entry of AGENT_WRITE_ROUTES) {
      const row = fields.rows.find(
        (cells) => keyOf(cells[0] ?? '') === `${entry.method} ${entry.pattern}`,
      );
      expect(row, entry.pattern).toBeDefined();
      const named = backticked(row?.[1] ?? '');
      for (const field of entry.fields) expect(named, `${entry.pattern} ${field}`).toContain(field);
    }
  });

  it('places the setting that decides the registration form’s username on the W2 side', () => {
    const row = fields.rows.find((cells) => (cells[0] ?? '').includes('PATCH ~/settings'));
    expect(row).toBeDefined();
    expect(backticked(row?.[3] ?? '')).toContain('registration_username');
    expect(backticked(row?.[2] ?? '')).not.toContain('registration_username');
  });

  it('states what the door admits now, exactly: the allowlist’s fields, or none yet', () => {
    for (const cells of fields.rows) {
      const key = keyOf(cells[0] ?? '');
      const entry = AGENT_WRITE_ROUTES.find((e) => `${e.method} ${e.pattern}` === key);
      const admitted = backticked(cells[2] ?? '');
      expect([...admitted].sort(), key).toEqual([...(entry?.fields ?? [])].sort());
      if (entry === undefined) expect(cells[2], key).toMatch(/^none/u);
      expect(doorKeys.has(key) || admitted.length === 0, key).toBe(true);
    }
  });
});
