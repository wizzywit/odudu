import { expect, it } from 'vitest';
import {
  NOTHING_HELD,
  afterDecision,
  entriesOf,
  stillWaiting,
  waitingLine,
  withDecision,
} from '#/widgets/assistant-panel/services/approvalEntries';
import type { ApprovalCard } from '#/widgets/assistant-panel/types/approvals';

function card(id: string, title = 'Create a group'): ApprovalCard {
  return {
    approval_id: id,
    tool_call_id: `call-${id}`,
    tool: 'create_group',
    title,
    target: { type: 'group' },
    before: null,
    after: { name: id },
    expires_at: '2026-11-26T05:45:00.000Z',
  };
}

it('draws the waiting cards, then the ones decided here that the server stopped listing', () => {
  const held = withDecision(NOTHING_HELD, 'c1', {
    card: card('gone'),
    offsetMs: 5,
    decision: { kind: 'decided', state: 'approved' },
  });
  const entries = entriesOf({ items: [card('a')], offsetMs: 100 }, held, 'c1');
  expect(entries.map((entry) => [entry.card.approval_id, entry.offsetMs])).toEqual([
    ['a', 100],
    ['gone', 5],
  ]);
});

it('keeps the decision with the card it was made on while the server still lists it', () => {
  const held = withDecision(NOTHING_HELD, 'c1', {
    card: card('a'),
    offsetMs: 7,
    decision: { kind: 'deciding', approve: true },
  });
  const [entry] = entriesOf({ items: [card('a')], offsetMs: 100 }, held, 'c1');
  expect(entry).toMatchObject({ offsetMs: 7, decision: { kind: 'deciding', approve: true } });
});

it('forgets what was decided in another conversation', () => {
  const held = withDecision(NOTHING_HELD, 'c1', {
    card: card('a'),
    offsetMs: 0,
    decision: { kind: 'decided', state: 'denied' },
  });
  expect(entriesOf(undefined, held, 'c2')).toEqual([]);
  expect(entriesOf(undefined, held, 'c1')).toHaveLength(1);
});

it('turns the server’s answer into a decision, and a refusal into words', () => {
  expect(
    afterDecision({ ok: true, status: 200, data: { state: 'denied' }, etag: null, next: null }),
  ).toEqual({
    kind: 'decided',
    state: 'denied',
  });
  const failed = afterDecision({
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'Conflict', status: 409 },
  });
  expect(failed).toMatchObject({ kind: 'failed' });
});

it('counts a card as waiting until it is decided, and a failed try is still waiting', () => {
  const base = { card: card('a'), offsetMs: 0 };
  expect(stillWaiting({ ...base, decision: undefined })).toBe(true);
  expect(stillWaiting({ ...base, decision: { kind: 'failed', problem: 'x', final: false } })).toBe(
    true,
  );
  expect(stillWaiting({ ...base, decision: { kind: 'failed', problem: 'x', final: true } })).toBe(
    false,
  );
  expect(stillWaiting({ ...base, decision: { kind: 'deciding', approve: true } })).toBe(false);
  expect(stillWaiting({ ...base, decision: { kind: 'decided', state: 'approved' } })).toBe(false);
});

it('says nothing until the card is known, then names the change once', () => {
  const entries = entriesOf(
    { items: [card('a', 'Create a group')], offsetMs: 0 },
    NOTHING_HELD,
    'c1',
  );
  expect(waitingLine('loading', [])).toBe('');
  expect(waitingLine('ready', entries)).toBe('Approval needed: Create a group');
  expect(waitingLine('ready', [])).toBe('Waiting for you');
  expect(waitingLine('failed', [])).toBe('Waiting for you');
});
