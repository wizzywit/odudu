import { describe, expect, it } from 'vitest';
import {
  deleteAgentQuerySchema,
  listAgentApprovalsQuerySchema,
  listAgentsQuerySchema,
} from '#/admin/agents';

const OWNER = '0198a3c1-7d2e-7b11-9c35-5d8f0a1b2c3d';

describe('the agent list query', () => {
  it('takes an owner that is an id, a state it knows and the paging controls', () => {
    expect(
      listAgentsQuerySchema.parse({ owner: OWNER, state: 'live', limit: '5', cursor: 'x' }),
    ).toEqual({ owner: OWNER, state: 'live', limit: 5, cursor: 'x' });
    expect(listAgentsQuerySchema.safeParse({ owner: 'alice' }).success).toBe(false);
    expect(listAgentsQuerySchema.safeParse({ state: 'pending' }).success).toBe(false);
    expect(listAgentsQuerySchema.safeParse({ tenant: 'x' }).success).toBe(false);
  });

  it('knows live, expired and revoked', () => {
    for (const state of ['live', 'expired', 'revoked']) {
      expect(listAgentsQuerySchema.safeParse({ state }).success, state).toBe(true);
    }
  });
});

describe('the agent approval list query', () => {
  it('takes each state an approval can be in, and nothing else', () => {
    for (const state of ['pending', 'approved', 'denied', 'expired', 'consumed']) {
      expect(listAgentApprovalsQuerySchema.safeParse({ state }).success, state).toBe(true);
    }
    expect(listAgentApprovalsQuerySchema.safeParse({ state: 'live' }).success).toBe(false);
    expect(listAgentApprovalsQuerySchema.safeParse({ owner: OWNER }).success).toBe(false);
  });
});

describe('the agent revoke query', () => {
  it('takes dry_run as true or false', () => {
    expect(deleteAgentQuerySchema.parse({})).toEqual({});
    expect(deleteAgentQuerySchema.parse({ dry_run: 'true' })).toEqual({ dry_run: 'true' });
    expect(deleteAgentQuerySchema.safeParse({ dry_run: 'yes' }).success).toBe(false);
    expect(deleteAgentQuerySchema.safeParse({ force: 'true' }).success).toBe(false);
  });
});
