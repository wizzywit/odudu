import { assembleJwks } from '@odudu/crypto';
import { type RealmLookup } from '#/repository/realm-lookup';

export interface PublishableKey {
  kid: string;
  alg: string;
  publicJwk: Record<string, unknown>;
}

export interface JwksUsecaseDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  listPublishableKeys(realmId: string): Promise<PublishableKey[]>;
}

export async function resolveJwks(
  deps: JwksUsecaseDeps,
  realmName: string,
): Promise<{ keys: Record<string, unknown>[] } | null> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return null;
  const keys = await deps.listPublishableKeys(realm.id);
  return assembleJwks(keys);
}
