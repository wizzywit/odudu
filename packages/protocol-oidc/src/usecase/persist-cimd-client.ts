import { type TenantScopedDatabase } from '@odudu/db';
import { clientRepository, provisionClientDefaults, type ClientRecord } from '@odudu/domain-tenant';
import { containsBidiControl } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { cimdClientRepository } from '#/repository/cimd-clients';
import { amendmentOf, cimdClientType, placementOf } from '#/service/cimd-client-plan';
import { type CimdClient } from '#/service/client-id-metadata';

/** Most clients a tenant keeps from metadata documents; `reap` frees the unused ones. */
export const CIMD_CLIENTS_PER_TENANT = 1000;

/** How long a client stays when nothing has resolved its document, before `reap` removes it. */
export const CIMD_CLIENT_UNUSED_SECONDS = 30 * 24 * 60 * 60;

export type PersistCimdOutcome = 'ok' | 'at_capacity' | 'foreign' | 'refused';

async function writeConfig(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  document: CimdClient,
): Promise<void> {
  await clientOidcConfigRepository(tx).create({
    clientId,
    tenantId,
    redirectUris: document.redirectUris,
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: document.tokenEndpointAuthMethod,
    audiences: [],
    accessTokenTtlSeconds: null,
    refreshTokenTtlSeconds: null,
    jwks: document.jwks,
    jwksUri: document.jwksUri,
    consentRequired: true,
  });
}

async function amend(
  tx: TenantScopedDatabase,
  existing: ClientRecord,
  document: CimdClient,
  now: Date,
): Promise<void> {
  const clients = clientRepository(tx);
  const configs = clientOidcConfigRepository(tx);
  const config = await configs.byClientId(existing.id);
  const changes = amendmentOf(existing, config, document, now);
  if (changes.client !== null) await clients.update(existing.id, changes.client);
  if (changes.config === 'create') {
    await writeConfig(tx, existing.tenantId, existing.id, document);
  } else if (changes.config !== null) {
    await configs.update(existing.id, changes.config);
  }
  if (changes.touch) await clients.markMetadataUsed(existing.id, now);
}

// Written exactly as a client registered by hand would be, so every later
// lookup (token, consent, userinfo) finds an ordinary client. It owns no
// secret and no service account, asks for consent every time, and has no
// audience: what it may reach is decided by the tenant's policy, never by
// the document.
async function insert(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: CimdClient,
  now: Date,
): Promise<void> {
  const created = await clientRepository(tx).create({
    tenantId,
    clientId: document.clientId,
    name: document.clientName,
    type: cimdClientType(document),
    secretHash: null,
    registrationOrigin: 'cimd',
    metadataUsedAt: now,
  });
  await provisionClientDefaults(tx, created.id);
  await writeConfig(tx, tenantId, created.id, document);
}

export async function persistCimdClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: CimdClient,
  now: Date,
  ceiling: number = CIMD_CLIENTS_PER_TENANT,
): Promise<PersistCimdOutcome> {
  if (containsBidiControl(document.clientName)) return 'refused';
  // One writer per tenant, so two first resolutions of different documents
  // cannot both pass the ceiling check.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cimd-clients:${tenantId}`}))`);
  const clients = clientRepository(tx);
  const existing = await clients.byClientId(document.clientId);
  const placement = placementOf(
    existing?.registrationOrigin ?? null,
    existing === null ? await clients.countCimdAtMost(ceiling) : 0,
    ceiling,
  );
  if (placement === 'foreign') return 'foreign';
  if (existing !== null) {
    await amend(tx, existing, document, now);
    return 'ok';
  }
  if (placement === 'make_room') {
    // Resolving a document needs no sign-in, so the ceiling cannot be held by
    // whoever filled it first: a row that never completed anything makes way.
    const evict = await cimdClientRepository(tx).evictable(now);
    if (evict === null) return 'at_capacity';
    await clients.delete(evict);
  }
  await insert(tx, tenantId, document, now);
  return 'ok';
}
