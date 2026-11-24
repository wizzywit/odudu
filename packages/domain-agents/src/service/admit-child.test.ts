import { describe, expect, it } from 'vitest';
import { admitChild, type AgentLimits, type AgentNode, type ChildRequest } from '#/index';

const at = (s: number): Date => new Date(1_000_000 + s * 1000);

const parent: AgentNode = {
  scope: ['read', 'write', 'admin'],
  expiresAt: at(100),
  depth: 1,
  liveChildren: 0,
};
const limits: AgentLimits = { maxDepth: 3, maxChildren: 2, sessionEndsAt: at(200) };
const request: ChildRequest = { scope: ['read', 'write'], expiresAt: at(50) };

describe('admitChild', () => {
  it('admits a narrower, shorter-lived child one level deeper', () => {
    expect(admitChild(parent, request, limits)).toEqual({
      kind: 'ok',
      node: { scope: ['read', 'write'], expiresAt: at(50), depth: 2, liveChildren: 0 },
    });
  });

  it('admits the same scope and the same expiry', () => {
    const same = { scope: parent.scope, expiresAt: parent.expiresAt };
    expect(admitChild(parent, same, limits).kind).toBe('ok');
  });

  it('refuses a scope that is not a subset', () => {
    expect(admitChild(parent, { ...request, scope: ['read', 'delete'] }, limits)).toEqual({
      kind: 'refused',
      invariant: 'scope_widened',
    });
  });

  it('refuses an expiry after the parent', () => {
    expect(admitChild(parent, { ...request, expiresAt: at(101) }, limits)).toEqual({
      kind: 'refused',
      invariant: 'ttl_exceeds_parent',
    });
  });

  it('refuses an expiry after the session when the parent outlives it', () => {
    const long = { ...parent, expiresAt: at(500) };
    expect(admitChild(long, { ...request, expiresAt: at(201) }, limits)).toEqual({
      kind: 'refused',
      invariant: 'ttl_exceeds_session',
    });
  });

  it('admits an expiry exactly at the session end', () => {
    const long = { ...parent, expiresAt: at(500) };
    expect(admitChild(long, { ...request, expiresAt: at(200) }, limits).kind).toBe('ok');
  });

  it('refuses past the maximum depth and admits at it', () => {
    expect(admitChild({ ...parent, depth: 3 }, request, limits)).toEqual({
      kind: 'refused',
      invariant: 'depth_exceeded',
    });
    expect(admitChild({ ...parent, depth: 2 }, request, limits).kind).toBe('ok');
  });

  it('refuses at the child limit and admits just under it', () => {
    expect(admitChild({ ...parent, liveChildren: 2 }, request, limits)).toEqual({
      kind: 'refused',
      invariant: 'fanout_exceeded',
    });
    expect(admitChild({ ...parent, liveChildren: 1 }, request, limits).kind).toBe('ok');
  });

  it('reports the first broken invariant in a fixed order', () => {
    const bad: ChildRequest = { scope: ['x'], expiresAt: at(900) };
    const all: AgentNode = { ...parent, depth: 3, liveChildren: 2 };
    expect(admitChild(all, bad, limits)).toMatchObject({ invariant: 'scope_widened' });
    expect(admitChild(all, { ...bad, scope: ['read'] }, limits)).toMatchObject({
      invariant: 'ttl_exceeds_parent',
    });
    const long = { ...all, expiresAt: at(500) };
    expect(admitChild(long, { scope: ['read'], expiresAt: at(300) }, limits)).toMatchObject({
      invariant: 'ttl_exceeds_session',
    });
    expect(admitChild(all, { scope: ['read'], expiresAt: at(10) }, limits)).toMatchObject({
      invariant: 'depth_exceeded',
    });
    expect(
      admitChild({ ...all, depth: 1 }, { scope: ['read'], expiresAt: at(10) }, limits),
    ).toMatchObject({
      invariant: 'fanout_exceeded',
    });
  });

  it('does not mutate its inputs', () => {
    const before = structuredClone(parent);
    admitChild(parent, request, limits);
    expect(parent).toEqual(before);
  });
});
