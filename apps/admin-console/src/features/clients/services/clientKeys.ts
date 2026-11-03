import { type Client } from '@odudu/contracts/admin';
import type { Choice } from '#/shared/services/choice';
import { isRecord } from '#/shared/services/json';

export type KeySource = 'none' | 'uri' | 'inline';

export const KEY_SOURCES: readonly Choice[] = [
  { id: 'none', label: 'None published' },
  { id: 'uri', label: 'A JWKS URI' },
  { id: 'inline', label: 'A key set pasted here' },
];

export const KEYS_RULE =
  'The public keys the server verifies the client with and encrypts to. A key set is kept as given and served back by every read, so a private key is refused.';

export const JWKS_URI_RULE =
  'An https address the server fetches the key set from. It must not point inside a private network.';

export function keySourceOf(client: Pick<Client, 'jwks' | 'jwks_uri'>): KeySource {
  if (client.jwks !== null && client.jwks !== undefined) return 'inline';
  return client.jwks_uri === null ? 'none' : 'uri';
}

export function jwksText(jwks: unknown): string {
  return jwks === null || jwks === undefined ? '' : JSON.stringify(jwks, null, 2);
}

export type Jwks = { ok: true; value: unknown } | { ok: false; problem: string };

// Shape only: which members a key may carry is the server's to judge, and
// it says so in its own words beside the field.
export function parseJwks(text: string): Jwks {
  if (text.trim() === '')
    return { ok: false, problem: 'Paste the key set, or choose another key source.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'This is not valid JSON.' };
  }
  const keys = isRecord(parsed) ? parsed.keys : undefined;
  if (!Array.isArray(keys)) {
    return { ok: false, problem: 'A key set is a JSON object with a "keys" array.' };
  }
  return { ok: true, value: parsed };
}

export const KEYS_BLOCKED = 'Correct the key source above before saving.';

export interface KeysProblem {
  field: 'jwks' | 'jwks_uri';
  message: string;
}

// What the chosen source lacks, once the section has been edited: a stored
// source is whole, and an untouched section holds nothing back.
export function keysProblem(
  values: { key_source: string; jwks_uri: string; jwks: string },
  edited: boolean,
): KeysProblem | undefined {
  if (!edited) return undefined;
  if (values.key_source === 'uri' && values.jwks_uri.trim() === '') {
    return { field: 'jwks_uri', message: 'Enter the address, or choose another key source.' };
  }
  if (values.key_source !== 'inline') return undefined;
  const parsed = parseJwks(values.jwks);
  return parsed.ok ? undefined : { field: 'jwks', message: parsed.problem };
}

// The other source is cleared, since the server holds the two exclusive.
export function keysPayload(values: { key_source: string; jwks_uri: string; jwks: string }): {
  jwks: unknown;
  jwks_uri: string | null;
} {
  const parsed = values.key_source === 'inline' ? parseJwks(values.jwks) : null;
  return {
    jwks: parsed?.ok === true ? parsed.value : null,
    jwks_uri: values.key_source === 'uri' ? values.jwks_uri.trim() : null,
  };
}
