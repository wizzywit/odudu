import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  narrowingDecision,
  policyDecision,
  promptHashOf,
  reservationDecision,
  slotDecision,
  trimmingDecision,
} from '#/service/trace-decisions';

const user = (text: string): ModelMessage => ({ role: 'user', content: text });
const assistant = (text: string): ModelMessage => ({ role: 'assistant', content: text });

describe('promptHashOf', () => {
  it('is a sha-256 hex digest that changes with either part of the prompt', () => {
    const a = promptHashOf('static', 'tenant');
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(promptHashOf('static', 'tenant')).toBe(a);
    expect(promptHashOf('static', 'other')).not.toBe(a);
    expect(promptHashOf('other', 'tenant')).not.toBe(a);
    expect(promptHashOf('ab', 'c')).not.toBe(promptHashOf('a', 'bc'));
  });
});

describe('slotDecision', () => {
  it('names the slot, the profile that asked for it and the model that answers', () => {
    const model = { provider: 'anthropic', modelId: 'claude-x' } as never;
    expect(slotDecision('standard', 'free-chat', model)).toEqual({
      slot: 'standard',
      profile: 'free-chat',
      reason: 'profile',
      provider: 'anthropic',
      model_id: 'claude-x',
    });
  });

  it('names a model given as a string by its id', () => {
    expect(slotDecision('fast', 'p', 'some-id')).toMatchObject({ model_id: 'some-id' });
  });
});

describe('reservationDecision', () => {
  it('says what was held and whether a level refused it', () => {
    expect(
      reservationDecision({ slot: 'fast', tokens: 900, fixedBytes: 10, messagesBytes: 20 }),
    ).toEqual({
      slot: 'fast',
      tokens: 900,
      fixed_bytes: 10,
      messages_bytes: 20,
      outcome: 'reserved',
    });
    expect(
      reservationDecision({
        slot: 'fast',
        tokens: 900,
        fixedBytes: 10,
        messagesBytes: 20,
        refusedBy: 'turn',
      }),
    ).toMatchObject({ outcome: 'refused', level: 'turn' });
  });
});

describe('narrowingDecision', () => {
  it('counts the tools the turn was offered by kind', () => {
    expect(narrowingDecision('act', 64, 12)).toEqual({ mode: 'act', reads: 64, writes: 12 });
  });
});

describe('policyDecision', () => {
  it.each([
    [undefined, 'allowed'],
    ['user-approval' as const, 'approval_requested'],
    [{ type: 'denied' as const, reason: 'no' }, 'denied'],
  ])('maps the status %j to %s without keeping the reason the model reads', (status, outcome) => {
    const decision = policyDecision('create_client', 'ask', 'ask', status);
    expect(decision).toEqual({ tool: 'create_client', mode: 'ask', verdict: 'ask', outcome });
  });
});

describe('trimmingDecision', () => {
  it('says nothing for messages that were not touched', () => {
    const messages = [user('a'), assistant('b')];
    expect(trimmingDecision(messages, [...messages])).toBeUndefined();
  });

  it('counts the messages left out and the ones cut', () => {
    const a = user('a');
    const b = assistant('b');
    const c = user('c');
    const cutC = user('c…');
    expect(trimmingDecision([a, b, c], [c])).toEqual({ before: 3, after: 1, trimmed: 2 });
    expect(trimmingDecision([a, b, c], [a, b, cutC])).toEqual({ before: 3, after: 3, trimmed: 1 });
  });
});
