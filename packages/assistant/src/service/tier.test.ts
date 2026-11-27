import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tierOfTool, WRITE_PLANS } from '#/service/approval-card';
import { raiseTier, tierOf, type Target, type TargetFacts } from '#/service/tier';

const NONE: TargetFacts = {
  adminReach: [],
  isOwner: false,
  isBuiltinClient: false,
  rootsConversationGrant: false,
};
const kind = (value: Target['kind']): Target => ({ kind: value });

describe('what rises a call to human-only', () => {
  it('takes a role or a group that reaches an administrator capability, whichever the tier', () => {
    for (const base of ['B', 'C'] as const) {
      for (const target of ['role', 'group', 'subject', 'client', 'other'] as const) {
        expect(raiseTier(base, kind(target), { ...NONE, adminReach: ['view-audit'] })).toEqual({
          x: 'admin-capability-reach',
        });
      }
    }
  });

  it('takes the administrator themselves and a subject who holds a capability', () => {
    expect(raiseTier('C', kind('subject'), { ...NONE, isOwner: true })).toEqual({
      x: 'admin-capability-reach',
    });
    expect(raiseTier('B', kind('subject'), { ...NONE, adminReach: ['manage-users'] })).toEqual({
      x: 'admin-capability-reach',
    });
    expect(raiseTier('C', kind('subject'), NONE)).toBe('C');
  });

  it('takes a built-in client and no other client', () => {
    expect(raiseTier('C', kind('client'), { ...NONE, isBuiltinClient: true })).toEqual({
      x: 'self-authority',
    });
    expect(raiseTier('C', kind('client'), NONE)).toBe('C');
  });

  it('takes the administrator’s own session and the one that roots the conversation', () => {
    expect(raiseTier('B', kind('session'), { ...NONE, isOwner: true })).toEqual({
      x: 'own-session',
    });
    expect(raiseTier('B', kind('session'), { ...NONE, rootsConversationGrant: true })).toEqual({
      x: 'own-session',
    });
    expect(raiseTier('B', kind('session'), NONE)).toBe('B');
  });

  it('leaves a fact about another kind of target alone', () => {
    expect(raiseTier('B', kind('role'), { ...NONE, isOwner: true })).toBe('B');
    expect(raiseTier('B', kind('group'), { ...NONE, isBuiltinClient: true })).toBe('B');
    expect(raiseTier('C', kind('other'), { ...NONE, rootsConversationGrant: true })).toBe('C');
  });

  it('never raises a tier A call, which grants nothing', () => {
    const every = { adminReach: ['manage-users'], isOwner: true, isBuiltinClient: true };
    for (const tool of Object.keys(WRITE_PLANS).filter((name) => tierOfTool(name) === 'A')) {
      expect(tierOf(tool, kind('role'), { ...every, rootsConversationGrant: true }), tool).toBe(
        'A',
      );
    }
  });
});

// A reference closure over generated graphs: roles nest roles, a group maps roles
// and has a parent. A group reaches what it, or an ancestor, maps; a role
// reaches what it nests, transitively. It is the definition the server's
// `admin_reach` queries answer, written the slow way.
interface Graph {
  readonly capability: readonly boolean[];
  readonly nests: readonly (readonly number[])[];
  readonly maps: readonly (readonly number[])[];
  readonly parent: readonly (number | null)[];
}

function roleReaches(graph: Graph, start: number): boolean {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length > 0) {
    const role = stack.pop() ?? 0;
    if (seen.has(role)) continue;
    seen.add(role);
    if (graph.capability[role] === true) return true;
    stack.push(...(graph.nests[role] ?? []));
  }
  return false;
}

function groupReaches(graph: Graph, start: number): boolean {
  const seen = new Set<number>();
  let at: number | null = start;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    if ((graph.maps[at] ?? []).some((role) => roleReaches(graph, role))) return true;
    at = graph.parent[at] ?? null;
  }
  return false;
}

const graphs = fc.integer({ min: 1, max: 6 }).chain((size) =>
  fc.record({
    capability: fc.array(fc.boolean(), { minLength: size, maxLength: size }),
    nests: fc.array(fc.array(fc.nat({ max: size - 1 }), { maxLength: 3 }), {
      minLength: size,
      maxLength: size,
    }),
    maps: fc.array(fc.array(fc.nat({ max: size - 1 }), { maxLength: 3 }), {
      minLength: size,
      maxLength: size,
    }),
    parent: fc.array(fc.option(fc.nat({ max: size - 1 }), { nil: null }), {
      minLength: size,
      maxLength: size,
    }),
  }),
);

describe('human-only over generated role and group graphs', () => {
  it('is X for a role exactly when it reaches a capability through its composites', () => {
    fc.assert(
      fc.property(graphs, fc.nat({ max: 5 }), fc.constantFrom('B', 'C'), (graph, pick, base) => {
        const role = pick % graph.capability.length;
        const reach = roleReaches(graph, role) ? ['view-audit'] : [];
        const outcome = raiseTier(base, kind('role'), { ...NONE, adminReach: reach });
        expect(typeof outcome === 'object').toBe(reach.length > 0);
      }),
    );
  });

  it('is X for a group exactly when it or an ancestor maps a role that reaches one', () => {
    fc.assert(
      fc.property(graphs, fc.nat({ max: 5 }), fc.constantFrom('B', 'C'), (graph, pick, base) => {
        const group = pick % graph.capability.length;
        const reach = groupReaches(graph, group) ? ['view-audit'] : [];
        const outcome = raiseTier(base, kind('group'), { ...NONE, adminReach: reach });
        expect(typeof outcome === 'object').toBe(reach.length > 0);
        if (reach.length === 0) expect(outcome).toBe(base);
      }),
    );
  });
});
