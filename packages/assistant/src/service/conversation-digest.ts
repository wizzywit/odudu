import { createHmac, hkdfSync } from 'node:crypto';

// The label that makes this key the tombstone digest's and nothing else's.
const LABEL = 'odudu/assistant/conversation-digest/v1';

/**
 * The key a conversation's digest is made under, derived from the
 * deployment's KEK so every server instance has the same one. Each tenant's
 * digests are made under a key derived from it and the tenant's id, so a
 * digest of one tenant's text says nothing about another's. An empty KEK is
 * refused.
 */
export function deriveDigestKey(kek: Uint8Array): Uint8Array {
  if (kek.length === 0) throw new Error('the digest key cannot be derived from an empty key');
  return new Uint8Array(hkdfSync('sha256', kek, new Uint8Array(), LABEL, 32));
}

/** One message as the digest reads it: what is stored, in the order it is stored. */
export interface DigestedMessage {
  readonly seq: number;
  readonly role: string;
  readonly parts: unknown;
}

/**
 * An incremental HMAC-SHA256 over a conversation's messages in order, as lower
 * case hex. Each message contributes its number, role and parts as JSON, so a
 * copy of the text matches only if every message and its order do. The digest
 * confirms a copy to whoever holds the key; it is not evidence of what was said.
 */
export function conversationDigest(key: Uint8Array, tenantId: string, conversationId: string) {
  const tenantKey = createHmac('sha256', key).update(tenantId).digest();
  const mac = createHmac('sha256', createHmac('sha256', tenantKey).update(conversationId).digest());
  return {
    add(message: DigestedMessage): void {
      mac.update(JSON.stringify([message.seq, message.role, message.parts]));
      mac.update('\n');
    },
    /** The digest. It ends the computation: ask once. */
    hex(): string {
      return mac.digest('hex');
    },
  };
}
