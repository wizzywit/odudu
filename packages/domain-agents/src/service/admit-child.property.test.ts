import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  admitChild,
  type AgentLimits,
  type AgentNode,
  type ChildRequest,
  type Invariant,
} from '#/index';

const SCOPES = ['a', 'b', 'c', 'd', 'e'];
const BASE = 1_000_000;

const scopeArb = fc.subarray(SCOPES);
const timeArb = fc.integer({ min: 0, max: 1000 }).map((s) => new Date(BASE + s));
const requestArb: fc.Arbitrary<ChildRequest> = fc.record({ scope: scopeArb, expiresAt: timeArb });
const limitsArb: fc.Arbitrary<AgentLimits> = fc.record({
  maxDepth: fc.integer({ min: 1, max: 8 }),
  maxChildren: fc.integer({ min: 1, max: 5 }),
  sessionEndsAt: timeArb,
});
const rootArb: fc.Arbitrary<AgentNode> = fc.record({
  scope: scopeArb,
  expiresAt: timeArb,
  depth: fc.constant(0),
  liveChildren: fc.integer({ min: 0, max: 5 }),
});

const subset = (a: readonly string[], b: readonly string[]): boolean =>
  a.every((s) => b.includes(s));

function directlyBroken(
  parent: AgentNode,
  request: ChildRequest,
  limits: AgentLimits,
): Invariant | null {
  if (!subset(request.scope, parent.scope)) return 'scope_widened';
  if (request.expiresAt.getTime() > parent.expiresAt.getTime()) return 'ttl_exceeds_parent';
  if (request.expiresAt.getTime() > limits.sessionEndsAt.getTime()) return 'ttl_exceeds_session';
  if (parent.depth + 1 > limits.maxDepth) return 'depth_exceeded';
  if (parent.liveChildren >= limits.maxChildren) return 'fanout_exceeded';
  return null;
}

describe('admitChild properties', () => {
  it('every accepted chain narrows scope, shortens expiry within the session and stays within depth', () => {
    fc.assert(
      fc.property(
        rootArb,
        limitsArb,
        fc.array(requestArb, { minLength: 1, maxLength: 12 }),
        (root, limits, requests) => {
          let node = root;
          for (const request of requests) {
            const outcome = admitChild(node, request, limits);
            if (outcome.kind === 'refused') break;
            const next = outcome.node;
            expect(subset(next.scope, node.scope)).toBe(true);
            expect(next.expiresAt.getTime()).toBeLessThanOrEqual(node.expiresAt.getTime());
            expect(next.expiresAt.getTime()).toBeLessThanOrEqual(limits.sessionEndsAt.getTime());
            expect(next.depth).toBe(node.depth + 1);
            expect(next.depth).toBeLessThanOrEqual(limits.maxDepth);
            node = next;
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('every refusal names the invariant a direct check shows was broken, and acceptance means none was', () => {
    fc.assert(
      fc.property(
        rootArb,
        fc.integer({ min: 0, max: 6 }),
        limitsArb,
        requestArb,
        (root, depth, limits, request) => {
          const parent = { ...root, depth };
          const outcome = admitChild(parent, request, limits);
          const broken = directlyBroken(parent, request, limits);
          if (outcome.kind === 'refused') {
            expect(outcome.invariant).toBe(broken);
          } else {
            expect(broken).toBeNull();
            expect(outcome.node.scope).toEqual(request.scope);
            expect(outcome.node.expiresAt).toEqual(request.expiresAt);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
