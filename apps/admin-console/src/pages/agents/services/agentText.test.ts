import { expect, it } from 'vitest';
import {
  approvalDecision,
  budgetText,
  detachedText,
  detailsLabel,
  narrowButtonLabel,
  revokeButtonLabel,
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

it('names the run a detached one was started by, by a short id', () => {
  expect(detachedText('0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
    'Started by run 0197a3b2, which is not on the loaded pages.',
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

it('labels a run’s controls by its client and a short id, so two runs of one client differ', () => {
  const id = '0197a3b2-1c4d-7e5f-8a9b-0c1d2e3f4a5b';
  expect(revokeButtonLabel('planner', id)).toBe('Revoke the run of planner, 0197a3b2');
  expect(detailsLabel(false, 'planner', id)).toBe('Show details of the run of planner, 0197a3b2');
  expect(detailsLabel(true, 'planner', id)).toBe('Hide details of the run of planner, 0197a3b2');
  expect(narrowButtonLabel(id)).toBe('Only the runs acting for 0197a3b2');
  expect(treeLabel('planner', id)).toBe('Started by the run of planner, 0197a3b2');
});
