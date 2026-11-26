import type { ModelMessage } from 'ai';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compactHistory } from '#/service/compact';
import { inputUpperBound } from '#/service/estimate';

const size = (messages: readonly ModelMessage[]): number =>
  inputUpperBound(JSON.stringify(messages));

const user = (text: string): ModelMessage => ({ role: 'user', content: text });
const reply = (text: string): ModelMessage => ({ role: 'assistant', content: text });
const system = (text: string): ModelMessage => ({ role: 'system', content: text });

function call(id: string): ModelMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: id, toolName: 'list_clients', input: {} }],
  };
}

function result(id: string, text: string): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'list_clients',
        output: { type: 'text', value: text },
      },
    ],
  };
}

describe('compactHistory', () => {
  it('returns the messages unchanged when they fit', () => {
    const messages = [user('a'), reply('b'), user('c')];
    expect(compactHistory(messages, 10_000)).toEqual(messages);
  });

  it('drops the oldest turns first and starts on a person message', () => {
    const messages = [
      user('first'.repeat(200)),
      reply('one'.repeat(200)),
      user('second'.repeat(200)),
      reply('two'.repeat(200)),
      user('last question'),
    ];
    const out = compactHistory(messages, 400);
    expect(out[0]?.role).toBe('user');
    expect(out.at(-1)).toEqual(user('last question'));
    expect(size(out)).toBeLessThanOrEqual(400);
  });

  it('keeps the system messages and the last user message however small the bound', () => {
    const messages = [
      system('be careful'),
      user('old'.repeat(500)),
      reply('x'.repeat(500)),
      user('now'),
    ];
    const out = compactHistory(messages, 120);
    expect(out[0]).toEqual(system('be careful'));
    expect(out.at(-1)).toEqual(user('now'));
    expect(size(out)).toBeLessThanOrEqual(120);
  });

  it('keeps a tool call with its result, and shrinks an old result rather than split them', () => {
    const messages = [
      user('look'),
      call('1'),
      result('1', 'r'.repeat(5000)),
      call('2'),
      result('2', 'short'),
    ];
    const out = compactHistory(messages, 600);
    const text = JSON.stringify(out);
    expect(text).toContain('"toolCallId":"1"');
    expect(text).not.toContain('r'.repeat(5000));
    expect(size(out)).toBeLessThanOrEqual(600);
  });

  it('cuts the newest tool result to a prefix that fits, keeping the call and saying so', () => {
    const messages = [user('look'), call('1'), result('1', `START${'r'.repeat(300_000)}`)];
    const out = compactHistory(messages, 20_000);
    const text = JSON.stringify(out);
    expect(size(out)).toBeLessThanOrEqual(20_000);
    expect(out).toHaveLength(3);
    expect(text).toContain('"toolCallId":"1"');
    expect(text).toContain('START');
    expect(text).toMatch(/cut to fit/u);
    expect(text).not.toContain('left out to fit');
  });

  it('keeps in-flight calls and results when the last user message must be cut', () => {
    const out = compactHistory([user('x'.repeat(40_000)), call('1'), result('1', 'short')], 5000);
    expect(size(out)).toBeLessThanOrEqual(5000);
    expect(JSON.stringify(out)).toContain('"toolCallId":"1"');
  });

  it('shortens the last user message when nothing else is left to give up', () => {
    const out = compactHistory([user('x'.repeat(10_000))], 500);
    expect(size(out)).toBeLessThanOrEqual(500);
    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe('user');
  });

  it('bounds the output below the limit for any mix of messages', () => {
    const message = fc.oneof(
      fc.string({ maxLength: 800 }).map(user),
      fc.string({ maxLength: 800 }).map(reply),
    );
    fc.assert(
      fc.property(
        fc.array(message, { maxLength: 30 }),
        fc.integer({ min: 300, max: 3000 }),
        (history, max) => {
          const out = compactHistory([...history, user('the question')], max);
          expect(size(out)).toBeLessThanOrEqual(max);
          expect(out.at(-1)?.role).toBe('user');
        },
      ),
    );
  });
});
