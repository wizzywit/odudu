import { describe, expect, it } from 'vitest';
import {
  conversationDigest,
  deriveDigestKey,
  type DigestedMessage,
} from '#/service/conversation-digest';

const KEK = new Uint8Array(32).fill(7);
const SYSTEM: DigestedMessage = {
  seq: 1,
  role: 'system',
  parts: [{ type: 'data-page_context', data: { route: '/clients' } }],
};
const ASKED: DigestedMessage = { seq: 2, role: 'user', parts: [{ type: 'text', text: 'hello' }] };

function digest(
  key: Uint8Array,
  tenant: string,
  messages: readonly DigestedMessage[] = [SYSTEM, ASKED],
  conversation = 'c1',
): string {
  const mac = conversationDigest(key, tenant, conversation);
  for (const message of messages) mac.add(message);
  return mac.hex();
}

describe('conversationDigest', () => {
  it('is 64 lower case hex digits and the same for the same messages', () => {
    const key = deriveDigestKey(KEK);
    expect(digest(key, 't1')).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest(key, 't1')).toBe(digest(key, 't1'));
  });

  it('changes with the tenant, the key, a message and the order', () => {
    const key = deriveDigestKey(KEK);
    const base = digest(key, 't1');
    expect(digest(key, 't2')).not.toBe(base);
    expect(digest(key, 't1', [SYSTEM, ASKED], 'c2')).not.toBe(base);
    expect(digest(deriveDigestKey(new Uint8Array(32).fill(8)), 't1')).not.toBe(base);
    const edited = { ...ASKED, parts: [{ type: 'text', text: 'hellp' }] };
    expect(digest(key, 't1', [SYSTEM, edited])).not.toBe(base);
    expect(digest(key, 't1', [ASKED, SYSTEM])).not.toBe(base);
  });

  it('refuses an empty key', () => {
    expect(() => deriveDigestKey(new Uint8Array())).toThrow(/empty/u);
  });
});
