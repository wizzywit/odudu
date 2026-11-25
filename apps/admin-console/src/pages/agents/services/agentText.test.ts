import { expect, it } from 'vitest';
import {
  approvalDecision,
  budgetText,
  detachedText,
  detailsLabel,
  narrowButtonLabel,
  ownerLinkLabel,
  ownerName,
  ownerNote,
  readingLabel,
  revokeButtonLabel,
  runName,
  treeLabel,
  endOf,
  APPROVAL_STATES,
  INSTANCE_STATES,
  instanceTone,
  approvalTone,
} from '#/pages/agents/services/agentText';
import type { AgentApproval, AgentInstance } from '#/pages/agents/types/agent';

const live: AgentInstance = {
  id: 'i1',
  owner: 'sub-ada',
  ownerUsername: 'ada',
  agentClient: 'planner',
  parent: null,
  depth: 1,
  state: 'live',
  scope: 'mcp:read',
  createdAt: '2026-11-25T08:00:00.000Z',
  expiresAt: '2026-11-25T08:15:00.000Z',
  revokedAt: null,
  budget: { mutating: 1, creates: 10 },
};

const decided: AgentApproval = {
  id: 'a1',
  owner: 'sub-ada',
  ownerUsername: 'ada',
  agentClient: 'planner',
  instance: 'i1',
  kind: 'tool_call',
  summary: 'Delete the client reports',
  state: 'approved',
  createdAt: '2026-11-25T08:00:00.000Z',
  expiresAt: '2026-11-25T08:10:00.000Z',
  decidedAt: '2026-11-25T08:01:00.000Z',
  decidedVia: 'ciba_page',
};

it('counts what a live run has left, in the words of the count', () => {
  expect(budgetText(live)).toBe('1 write and 10 creates left');
  expect(budgetText({ ...live, budget: { mutating: 0, creates: 1 } })).toBe(
    '0 writes and 1 create left',
  );
});

it('gives a run that is no longer live no budget to speak of', () => {
  expect(budgetText({ ...live, state: 'expired' })).toBeNull();
  expect(budgetText({ ...live, state: 'revoked' })).toBeNull();
});

it('says when a run ends, ended or was ended, by its state', () => {
  expect(endOf(live)).toEqual({ label: 'Expires', at: live.expiresAt });
  expect(endOf({ ...live, state: 'expired' })).toEqual({ label: 'Expired', at: live.expiresAt });
  expect(endOf({ ...live, state: 'revoked', revokedAt: '2026-11-25T08:05:00.000Z' })).toEqual({
    label: 'Revoked',
    at: '2026-11-25T08:05:00.000Z',
  });
  expect(endOf({ ...live, state: 'revoked', revokedAt: null })).toEqual({
    label: 'Revoked',
    at: live.expiresAt,
  });
});

it('says the run a detached one was started by is outside the view, by the end of its id', () => {
  expect(detachedText('0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
    'Started by run 2e3f4a5b, which is not in this view.',
  );
});

it('words how and when an approval was decided, or that it has not been', () => {
  expect(approvalDecision(decided)).toBe('Approved on the approval page');
  expect(approvalDecision({ ...decided, state: 'denied', decidedVia: 'console' })).toBe(
    'Denied in the console',
  );
  expect(
    approvalDecision({ ...decided, state: 'pending', decidedAt: null, decidedVia: null }),
  ).toBe('Waiting for the person it is for');
  expect(
    approvalDecision({ ...decided, state: 'expired', decidedAt: null, decidedVia: null }),
  ).toBe('Lapsed with no answer');
  expect(approvalDecision({ ...decided, state: 'consumed', decidedVia: 'ciba_page' })).toBe(
    'Approved on the approval page, and used',
  );
});

it('tones each state, and offers each as a filter after Any state', () => {
  expect(instanceTone('live')).toBe('active');
  expect(instanceTone('revoked')).toBe('danger');
  expect(instanceTone('expired')).toBe('neutral');
  expect(approvalTone('pending')).toBe('warning');
  expect(approvalTone('approved')).toBe('active');
  expect(approvalTone('denied')).toBe('danger');
  expect(INSTANCE_STATES.map((state) => state.id)).toEqual(['any', 'live', 'expired', 'revoked']);
  expect(APPROVAL_STATES.map((state) => state.id)).toEqual([
    'any',
    'pending',
    'approved',
    'denied',
    'expired',
    'consumed',
  ]);
});

it('names a run by its client, its start and the end of its id, so siblings differ', () => {
  const sibling = { ...live, id: '0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5c' };
  const first = { ...live, id: '0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b' };
  expect(runName(first)).toBe('planner started 2026-11-25 08:00:00 UTC (2e3f4a5b)');
  expect(runName(sibling)).not.toBe(runName(first));
  expect(revokeButtonLabel(first)).toBe(
    'Revoke planner started 2026-11-25 08:00:00 UTC (2e3f4a5b)',
  );
  expect(detailsLabel(false, first)).toBe(
    'Show details of planner started 2026-11-25 08:00:00 UTC (2e3f4a5b)',
  );
  expect(detailsLabel(true, first)).toContain('Hide details of planner started');
  expect(treeLabel(first)).toBe('Started by planner started 2026-11-25 08:00:00 UTC (2e3f4a5b)');
  expect(readingLabel(first)).toBe('Reading planner started 2026-11-25 08:00:00 UTC (2e3f4a5b)');
});

it('names an owner by username, or by the end of its id', () => {
  expect(ownerName('0197a3b1-aaaa-7bbb-8ccc-0d1e2f3a4b5c', 'ada')).toBe('ada');
  expect(ownerName('0197a3b1-aaaa-7bbb-8ccc-0d1e2f3a4b5c', null)).toBe('2f3a4b5c');
  expect(narrowButtonLabel('ada')).toBe('Only the runs acting for ada');
  expect(ownerNote('ada')).toBe('Only the runs acting for ada.');
  expect(ownerLinkLabel('ada')).toBe('Open the owner ada');
});
