import {
  USERINFO_ENCRYPTION_ALGS,
  USERINFO_ENCRYPTION_ENC_DEFAULT,
  USERINFO_ENCRYPTION_ENCS,
  USERINFO_SIGNING_ALGS,
} from '@odudu/contracts/admin';
import { AUTO, sentOf } from '#/pages/clients/services/choices';
import type { Choice } from '#/shared/services/choice';

export const USERINFO_RULE =
  'How UserInfo answers this client: signed, and then encrypted to a key it publishes above. Left alone it answers plain JSON.';

export function userinfoSigningOptions(): Choice[] {
  return [
    { id: AUTO, label: 'Plain JSON, not signed' },
    ...USERINFO_SIGNING_ALGS.map((id) => ({
      id,
      label: id === 'none' ? 'An unsigned JWT (none)' : id,
    })),
  ];
}

export function userinfoEncryptionOptions(): Choice[] {
  return [
    { id: AUTO, label: 'Not encrypted' },
    ...USERINFO_ENCRYPTION_ALGS.map((id) => ({ id, label: id })),
  ];
}

export function userinfoContentOptions(): Choice[] {
  return [
    { id: AUTO, label: `Default (${USERINFO_ENCRYPTION_ENC_DEFAULT})` },
    ...USERINFO_ENCRYPTION_ENCS.map((id) => ({ id, label: id })),
  ];
}

export function encryptsUserinfo(algorithm: string): boolean {
  return algorithm !== AUTO;
}

// A content encryption names an algorithm to go with, so it is dropped with it.
export function userinfoPayload(values: {
  userinfo_signed_response_alg: string;
  userinfo_encrypted_response_alg: string;
  userinfo_encrypted_response_enc: string;
}): {
  userinfo_signed_response_alg: string | null;
  userinfo_encrypted_response_alg: string | null;
  userinfo_encrypted_response_enc: string | null;
} {
  const encrypted = encryptsUserinfo(values.userinfo_encrypted_response_alg);
  return {
    userinfo_signed_response_alg: sentOf(values.userinfo_signed_response_alg),
    userinfo_encrypted_response_alg: sentOf(values.userinfo_encrypted_response_alg),
    userinfo_encrypted_response_enc: encrypted
      ? sentOf(values.userinfo_encrypted_response_enc)
      : null,
  };
}
