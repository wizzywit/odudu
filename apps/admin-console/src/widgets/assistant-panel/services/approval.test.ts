import { expect, it } from 'vitest';
import {
  cardModel,
  clockOffset,
  countdownAnnouncement,
  countdownText,
  decisionFailure,
  decisionIsFinal,
  diffRows,
  outcomeOfStep,
  removesSomething,
  mayAnswer,
  approveRoute,
  confirmOpen,
  resumes,
  secondsLeft,
} from '#/widgets/assistant-panel/services/approval';
import type { ApprovalCard } from '#/widgets/assistant-panel/types/approvals';

const CARD: ApprovalCard = {
  approval_id: 'a1',
  tool_call_id: 'c1',
  tool: 'update_role_description',
  title: 'Change the description of a role',
  target: { type: 'role', id: 'r1', name: 'auditors' },
  before: { description: 'Old text' },
  after: { description: 'Reviews the audit trail' },
  expires_at: '2026-11-26T05:45:00.000Z',
};

it('marks what each field becomes, in words', () => {
  expect(
    diffRows({ name: 'a', kept: 'x', gone: 'y' }, { name: 'b', kept: 'x', fresh: 'z' }),
  ).toEqual([
    { label: 'Name', before: 'a', after: 'b', change: 'changed' },
    { label: 'Kept', before: 'x', after: 'x', change: 'same' },
    { label: 'Fresh', before: '(not set)', after: 'z', change: 'added' },
    { label: 'Gone', before: 'y', after: '(not set)', change: 'removed' },
  ]);
});

it('shows a target that does not exist yet as all added, and an empty value as empty', () => {
  expect(diffRows(null, { name: 'ops', description: '' })).toEqual([
    { label: 'Name', before: '(not set)', after: 'ops', change: 'added' },
    { label: 'Description', before: '(not set)', after: '(empty)', change: 'added' },
  ]);
  expect(diffRows({ flag: false, count: 0 }, null)).toEqual([
    { label: 'Flag', before: 'false', after: '(not set)', change: 'removed' },
    { label: 'Count', before: '0', after: '(not set)', change: 'removed' },
  ]);
});

it('counts down by the server clock, not the browser’s', () => {
  const offset = clockOffset('Thu, 26 Nov 2026 05:40:00 GMT', Date.parse('2026-11-26T05:30:00Z'));
  expect(offset).toBe(600_999);
  const expires = '2026-11-26T05:45:00.000Z';
  // The browser says 05:30:00, the server 05:40:00, so five minutes are left.
  expect(secondsLeft(expires, Date.parse('2026-11-26T05:30:00Z'), offset)).toBe(300);
  expect(secondsLeft(expires, Date.parse('2026-11-26T05:30:00Z'), 0)).toBe(900);
  expect(secondsLeft(expires, Date.parse('2026-11-26T06:00:00Z'), 0)).toBe(0);
  expect(clockOffset(null, 5)).toBe(0);
  expect(clockOffset('not a date', 5)).toBe(0);
  expect(secondsLeft('nonsense', 0, 0)).toBe(0);
});

it('words the time left, and announces it only at one minute and at expiry', () => {
  expect(countdownText(241)).toBe('Expires in 5 min');
  expect(countdownText(45)).toBe('Expires in 45 s');
  expect(countdownText(0)).toBe('Expired');
  expect(countdownAnnouncement(300)).toBe('');
  expect(countdownAnnouncement(61)).toBe('');
  const minute = countdownAnnouncement(60);
  expect(minute).toBe('One minute left to decide');
  expect(countdownAnnouncement(12)).toBe(minute);
  expect(countdownAnnouncement(0)).toBe('The approval expired');
});

it('puts the outcome where the buttons were, and never approves by expiry', () => {
  const open = cardModel({
    card: CARD,
    username: 'ada',
    tenant: null,
    decision: undefined,
    seconds: 300,
  });
  expect(open).toMatchObject({
    status: 'pending',
    who: 'You, as ada',
    remaining: 'Expires in 5 min',
    outcome: null,
    title: 'Change the description of a role',
    targetName: 'auditors',
    creating: false,
    risky: false,
  });
  expect(
    cardModel({ card: CARD, username: 'ada', tenant: null, decision: undefined, seconds: 0 }),
  ).toMatchObject({
    status: 'expired',
    outcome: 'Expired. Nothing was changed.',
    announcement: 'The approval expired',
  });
  expect(
    cardModel({
      card: CARD,
      username: 'ada',
      tenant: null,
      decision: { kind: 'decided', state: 'denied' },
      seconds: 100,
    }),
  ).toMatchObject({ status: 'refused', outcome: 'Refused by you. Nothing was changed.' });
  expect(
    cardModel({
      card: CARD,
      username: 'ada',
      tenant: null,
      decision: { kind: 'decided', state: 'approved' },
      seconds: 0,
    }).status,
  ).toBe('approved');
  expect(
    cardModel({
      card: CARD,
      username: 'ada',
      tenant: null,
      decision: { kind: 'deciding', approve: true },
      seconds: 100,
    }).status,
  ).toBe('deciding');
  expect(
    cardModel({
      card: CARD,
      username: 'ada',
      tenant: null,
      decision: { kind: 'failed', problem: 'Nope', final: false },
      seconds: 100,
    }),
  ).toMatchObject({ status: 'pending', problem: 'Nope' });
  expect(
    cardModel({
      card: CARD,
      username: 'ada',
      tenant: null,
      decision: { kind: 'failed', problem: 'Gone', final: true },
      seconds: 100,
    }),
  ).toMatchObject({ status: 'closed', problem: 'Gone', remaining: 'Closed', outcome: null });
});

it('asks once more only for a change that removes something', () => {
  expect(removesSomething('clear_message_override')).toBe(true);
  expect(removesSomething('create_group')).toBe(false);
});

it('words a refused decision by its cause', () => {
  const problem = (status: number) =>
    ({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 't', status },
    }) as const;
  expect([409, 403, 404].map((status) => decisionIsFinal(problem(status)))).toEqual([
    true,
    true,
    true,
  ]);
  expect(decisionIsFinal(problem(500))).toBe(false);
  expect(decisionIsFinal({ ok: false, kind: 'network' })).toBe(false);
  expect(decisionFailure(problem(409))).toContain('already decided or has expired');
  expect(decisionFailure(problem(403))).toContain('Only you');
  expect(decisionFailure(problem(404))).toContain('no longer there');
  expect(decisionFailure(problem(500))).toContain('could not be sent');
  expect(decisionFailure({ ok: false, kind: 'network' })).toContain('could not reach');
  expect(decisionFailure({ ok: false, kind: 'schema' })).toContain('could not be sent');
});

it('says what a finished write step became, and nothing of a read', () => {
  expect(outcomeOfStep('create_group', 'done')).toContain('Approved by you');
  expect(outcomeOfStep('create_group', 'denied')).toContain('Not approved');
  expect(outcomeOfStep('create_group', 'waiting')).toBeNull();
  expect(outcomeOfStep('list_roles', 'done')).toBeNull();
});

it('says an approval was applied only once its step is done', () => {
  const approved = { kind: 'decided', state: 'approved' } as const;
  const outcome = (step?: 'waiting' | 'running' | 'done' | 'failed' | 'denied') =>
    cardModel({ card: CARD, username: 'ada', tenant: null, decision: approved, seconds: 100, step })
      .outcome;
  expect(outcome()).toBe('Approved. Applying the change…');
  expect(outcome('waiting')).toBe('Approved. Applying the change…');
  expect(outcome('running')).toBe('Approved. Applying the change…');
  expect(outcome('done')).toBe('Approved by you. The change was made.');
  expect(outcome('failed')).toContain('the change failed');
  expect(outcomeOfStep('create_group', 'failed')).toContain('the change failed');
});

it('counts the second the server was in as its last moment, so a card is never open past expiry', () => {
  const offset = clockOffset('Thu, 26 Nov 2026 05:44:59 GMT', Date.parse('2026-11-26T05:44:59Z'));
  expect(offset).toBe(999);
  expect(
    secondsLeft('2026-11-26T05:45:00.000Z', Date.parse('2026-11-26T05:44:59.100Z'), offset),
  ).toBe(0);
});

it('answers a card once, and never again after the server took a decision', () => {
  expect(mayAnswer(undefined)).toBe(true);
  expect(mayAnswer({ kind: 'failed', problem: 'x', final: false })).toBe(true);
  expect(mayAnswer({ kind: 'failed', problem: 'x', final: true })).toBe(false);
  expect(mayAnswer({ kind: 'deciding', approve: true })).toBe(false);
  expect(mayAnswer({ kind: 'decided', state: 'approved' })).toBe(false);
  expect(approveRoute(true)).toBe('confirm');
  expect(approveRoute(false)).toBe('send');
  expect(confirmOpen(true, 'pending')).toBe(true);
  expect(confirmOpen(true, 'expired')).toBe(false);
  expect(resumes({ kind: 'decided', state: 'denied' })).toBe(true);
  expect(resumes({ kind: 'failed', problem: 'x', final: true })).toBe(false);
});

it('names the tenant a change lands in, on the card and in the removal question, only when it is not the own', () => {
  const own = cardModel({
    card: CARD,
    username: 'ada',
    tenant: null,
    decision: undefined,
    seconds: 300,
  });
  expect(own).toMatchObject({
    kicker: 'Change waiting for your approval',
    tenant: null,
    tenantNote: null,
    removal: { title: 'Approve this removal?' },
  });
  const away = cardModel({
    card: CARD,
    username: 'ada',
    tenant: 'demo',
    decision: undefined,
    seconds: 300,
  });
  expect(away).toMatchObject({
    kicker: 'Change in demo waiting for your approval',
    tenant: 'demo',
    tenantNote: 'demo is not your own tenant. Approving makes the change there.',
    removal: {
      title: 'Approve this removal in demo?',
      consequence: expect.stringContaining('in demo, not in your own tenant') as string,
    },
  });
});
