import { hkdfSync } from 'node:crypto';

// The label that makes this key the approval signature's and nothing else's.
const LABEL = 'odudu/assistant/tool-approval-signature/v1';

/**
 * The secret that signs a pending approval request, derived from the
 * deployment's KEK with HKDF so every server instance has the same one and no
 * variable has to be set. An empty KEK is refused: the SDK throws on an empty
 * secret, and signing must never be switched off by a missing value.
 */
export function deriveApprovalSecret(kek: Uint8Array): Uint8Array {
  if (kek.length === 0) throw new Error('the approval secret cannot be derived from an empty key');
  return new Uint8Array(hkdfSync('sha256', kek, new Uint8Array(), LABEL, 32));
}
