import { listKeysResponseSchema, MAX_LIMIT } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { SigningKey } from '#/entities/signing-key/types/signingKey';

// One page of a tenant's keys, as the lanes read them (a status filter) and
// as the overview reads them all.
export const readKeyPage = listReader('keys', listKeysResponseSchema);

// A tenant holds a handful of keys; this bounds a cursor that never ends.
const MAX_KEY_PAGES = 10;

// A defect is logged where it is found, as the gateway logs its own.
function logDefect(message: string): void {
  console.error(message);
}

export async function readKeys(
  gateway: Gateway,
  tenant: string,
  log: (message: string) => void = logDefect,
): Promise<GatewayResult<readonly SigningKey[]>> {
  const keys: SigningKey[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_KEY_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(MAX_LIMIT) });
    if (cursor !== undefined) query.set('cursor', cursor);
    const result = await readKeyPage(gateway, tenant, query);
    if (!result.ok) return result;
    keys.push(...result.data.items);
    cursor = result.data.next;
    if (cursor === undefined) return { ...result, data: keys };
  }
  log(
    `console defect: GET keys of ${tenant} still had a next page after ${String(MAX_KEY_PAGES)} pages`,
  );
  return { ok: false, kind: 'defect' };
}
