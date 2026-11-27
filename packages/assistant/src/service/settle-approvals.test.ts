import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { ApprovalCardRow, ApprovalState } from '#/service/approval-types';
import { settleParts } from '#/service/settle-approvals';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const LATER = new Date('2026-11-26T10:05:00.000Z');
const EARLIER = new Date('2026-11-26T09:55:00.000Z');

function part(toolCallId: string, state = 'approval-requested'): UIMessage['parts'][number] {
  return {
    type: 'tool-update_client_metadata',
    toolCallId,
    state,
    input: { id: 'x' },
    approval: { id: `sdk-${toolCallId}` },
  } as unknown as UIMessage['parts'][number];
}

function card(toolCallId: string, state: ApprovalState, expiresAt = LATER): ApprovalCardRow {
  return {
    approvalId: `ap-${toolCallId}`,
    conversationId: 'c',
    toolCallId,
    tool: 'update_client_metadata',
    body: {
      title: 't',
      tier: 'A',
      confirm_with: null,
      target: { type: 'client' },
      before: null,
      after: null,
    },
    state,
    expiresAt,
  };
}

const of = (settled: ReturnType<typeof settleParts>, id: string) =>
  settled.parts.find(
    (entry) => (entry as { toolCallId?: string }).toolCallId === id,
  ) as unknown as Record<string, unknown>;

describe('settleParts on resume', () => {
  it('hands an approved change back to the SDK to run', () => {
    const settled = settleParts([part('1')], [card('1', 'approved')], NOW, 'resume');
    expect(of(settled, '1')).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'sdk-1', approved: true },
    });
    expect(settled).toMatchObject({ waiting: 0, resumable: 1, settled: 1 });
  });

  it('closes a refused change with the reason, without running it', () => {
    const settled = settleParts([part('1')], [card('1', 'denied')], NOW, 'resume');
    expect(of(settled, '1')).toMatchObject({
      state: 'output-denied',
      approval: { id: 'sdk-1', approved: false },
    });
    expect(settled.resumable).toBe(0);
  });

  it('closes a change whose approval ended, pending or marked expired, as refused', () => {
    const pending = settleParts([part('1')], [card('1', 'pending', EARLIER)], NOW, 'resume');
    const expired = settleParts([part('1')], [card('1', 'expired', LATER)], NOW, 'resume');
    for (const settled of [pending, expired]) {
      expect(of(settled, '1')).toMatchObject({ state: 'output-denied' });
      expect(JSON.stringify(of(settled, '1'))).toMatch(/ended before it was decided/u);
    }
  });

  it('waits while an approval is still live', () => {
    const settled = settleParts([part('1')], [card('1', 'pending')], NOW, 'resume');
    expect(settled).toMatchObject({ waiting: 1, settled: 0 });
    expect(of(settled, '1')).toMatchObject({ state: 'approval-requested' });
  });

  it('says the outcome is not known for a change already spent with no result stored', () => {
    const settled = settleParts([part('1')], [card('1', 'consumed')], NOW, 'resume');
    expect(of(settled, '1')).toMatchObject({ state: 'output-error' });
    expect(JSON.stringify(of(settled, '1'))).toMatch(/not known/u);
  });

  it('counts a change an earlier call handed back and did not get to run', () => {
    const handed = {
      ...part('1', 'approval-responded'),
      approval: { id: 'sdk-1', approved: true },
    } as UIMessage['parts'][number];
    const settled = settleParts([handed], [card('1', 'approved')], NOW, 'resume');
    expect(settled.parts).toEqual([handed]);
    expect(settled).toMatchObject({ resumable: 1, settled: 0, waiting: 0 });
  });

  it('leaves a part with no card, and any other part, as it was', () => {
    const text = { type: 'text', text: 'hi' } as UIMessage['parts'][number];
    const settled = settleParts([text, part('9')], [card('1', 'approved')], NOW, 'resume');
    expect(settled.parts).toEqual([text, part('9')]);
    expect(settled.settled).toBe(0);
  });
});

describe('settleParts when the person sends another message', () => {
  it('never hands an approved change to the SDK: it was not run and is closed as such', () => {
    const settled = settleParts([part('1')], [card('1', 'approved')], NOW, 'message');
    expect(of(settled, '1')).toMatchObject({ state: 'output-denied' });
    expect(settled.resumable).toBe(0);
  });

  it('closes a refused one the same way', () => {
    const settled = settleParts([part('1')], [card('1', 'denied')], NOW, 'message');
    expect(of(settled, '1')).toMatchObject({ state: 'output-denied' });
  });
});

describe('settleParts for a handed-back change when the person sends another message', () => {
  it('closes it as not run', () => {
    const handed = {
      ...part('1', 'approval-responded'),
      approval: { id: 'sdk-1', approved: true },
    } as UIMessage['parts'][number];
    const settled = settleParts([handed], [card('1', 'approved')], NOW, 'message');
    expect(of(settled, '1')).toMatchObject({ state: 'output-denied' });
    expect(settled).toMatchObject({ resumable: 0, settled: 1 });
  });
});

describe('settleParts for a change handed back and already spent', () => {
  it('closes it as unknown, never as run again, when its card is consumed', () => {
    const handed = {
      ...part('1', 'approval-responded'),
      approval: { id: 'sdk-1', approved: true },
    } as UIMessage['parts'][number];
    const settled = settleParts([handed], [card('1', 'consumed')], NOW, 'resume');
    expect(of(settled, '1')).toMatchObject({ state: 'output-error' });
    expect(JSON.stringify(of(settled, '1'))).toMatch(/not known/u);
    expect(settled).toMatchObject({ resumable: 0, settled: 1 });
  });

  it('keeps the signature the SDK put on the request when it hands one back', () => {
    const requested = {
      ...part('1'),
      approval: { id: 'sdk-1', signature: 'sig' },
    } as UIMessage['parts'][number];
    const settled = settleParts([requested], [card('1', 'approved')], NOW, 'resume');
    expect(of(settled, '1')).toMatchObject({
      approval: { id: 'sdk-1', signature: 'sig', approved: true },
    });
  });
});
