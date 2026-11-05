import { type ClientRecord } from '@odudu/domain-tenant';
import { type ResolveCimdOutcome } from '#/usecase/resolve-cimd-document';
import { isCimdClientId, parseCimdDocument, type CimdClient } from '#/service/client-id-metadata';
import { type PersistCimdOutcome } from '#/usecase/persist-cimd-client';

export interface RefreshCimdDeps {
  readonly resolveDocument: (tenantId: string, url: string) => Promise<ResolveCimdOutcome>;
  readonly persist: (
    tenantId: string,
    client: CimdClient,
    now: Date,
  ) => Promise<PersistCimdOutcome>;
  readonly now: () => Date;
  readonly warn: (message: string, context: Record<string, string>) => void;
}

// Whether the client the URL names is now stored as the document describes
// it. Anything short of that, a document that cannot be fetched included,
// leaves it unusable: a redirect address the owner has since withdrawn must
// not keep working because the owner's server is down.
export async function refreshCimdClient(
  tenantId: string,
  url: string,
  deps: RefreshCimdDeps,
): Promise<boolean> {
  const resolved = await deps.resolveDocument(tenantId, url);
  if (resolved.kind === 'refused') {
    deps.warn('client metadata document refused', {
      tenantId,
      host: new URL(url).hostname,
      reason: resolved.reason,
    });
    return false;
  }
  const parsed = parseCimdDocument(url, resolved.body);
  if (parsed.kind !== 'ok') return false;
  return (await deps.persist(tenantId, parsed.client, deps.now())) === 'ok';
}

export interface AuthorizeClientDeps<R extends { client: ClientRecord | null }> {
  readonly resolveClient: (tenantId: string, oauthClientId: string) => Promise<R>;
  readonly refreshCimdClient?: (tenantId: string, url: string) => Promise<boolean>;
  // What resolveClient answers for a client nobody registered.
  readonly empty: R;
}

// The client /authorize is asked for. A client_id that is a URL is first a
// question of whether a client already holds it: one registered by hand is
// served as it is. Otherwise it is a metadata document client, which exists
// only while the tenant allows them, and with the setting off the answer is
// the one an unknown id gets.
export async function resolveAuthorizeClient<R extends { client: ClientRecord | null }>(
  deps: AuthorizeClientDeps<R>,
  tenant: { readonly id: string; readonly cimdEnabled: boolean },
  oauthClientId: string,
): Promise<R> {
  const held = await deps.resolveClient(tenant.id, oauthClientId);
  if (!isCimdClientId(oauthClientId)) return held;
  if (held.client !== null && held.client.registrationOrigin !== 'cimd') return held;
  if (!tenant.cimdEnabled || deps.refreshCimdClient === undefined) return deps.empty;
  return (await deps.refreshCimdClient(tenant.id, oauthClientId))
    ? deps.resolveClient(tenant.id, oauthClientId)
    : deps.empty;
}
