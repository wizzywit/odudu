import { type TenantScopedDatabase } from '@odudu/db';
import { clientRepository, provisionClientDefaults, type ClientRecord } from '@odudu/domain-tenant';
import { containsBidiControl } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { type CimdClient } from '#/service/client-id-metadata';

/** Most clients a tenant keeps from metadata documents; `reap` frees the unused ones. */
export const CIMD_CLIENTS_PER_TENANT = 1000;

/** How long a client stays when nothing has resolved its document, before `reap` removes it. */
export const CIMD_CLIENT_UNUSED_SECONDS = 30 * 24 * 60 * 60;

const LAST_USED_GRANULARITY_MS = 24 * 60 * 60 * 1000;

export type PersistCimdOutcome = 'ok' | 'at_capacity' | 'foreign' | 'refused';

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function typeOf(client: CimdClient): ClientRecord['type'] {
  return client.tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
}

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
  const type = typeOf(document);
  if (existing.name !== document.clientName || existing.type !== type) {
    await clients.update(existing.id, { name: document.clientName, type });
  }
  const config = await configs.byClientId(existing.id);
  if (config === null) {
    await writeConfig(tx, existing.tenantId, existing.id, document);
  } else if (
    !sameList(config.redirectUris, document.redirectUris) ||
    config.tokenEndpointAuthMethod !== document.tokenEndpointAuthMethod ||
    !sameJson(config.jwks, document.jwks) ||
    config.jwksUri !== document.jwksUri
  ) {
    await configs.update(existing.id, {
      redirectUris: document.redirectUris,
      tokenEndpointAuthMethod: document.tokenEndpointAuthMethod,
      jwks: document.jwks,
      jwksUri: document.jwksUri,
    });
  }
  const usedAt = existing.metadataUsedAt;
  if (usedAt === null || now.getTime() - usedAt.getTime() >= LAST_USED_GRANULARITY_MS) {
    await clients.markMetadataUsed(existing.id, now);
  }
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
    type: typeOf(document),
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
): Promise<PersistCimdOutcome> {
  if (containsBidiControl(document.clientName)) return 'refused';
  // One writer per tenant, so two first resolutions of different documents
  // cannot both pass the ceiling check.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cimd-clients:${tenantId}`}))`);
  const existing = await clientRepository(tx).byClientId(document.clientId);
  if (existing !== null) {
    if (existing.registrationOrigin !== 'cimd') return 'foreign';
    await amend(tx, existing, document, now);
    return 'ok';
  }
  if (
    (await clientRepository(tx).countCimdAtMost(CIMD_CLIENTS_PER_TENANT)) >= CIMD_CLIENTS_PER_TENANT
  ) {
    return 'at_capacity';
  }
  await insert(tx, tenantId, document, now);
  return 'ok';
}
