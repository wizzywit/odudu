import { wrapSecret } from '@odudu/crypto';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, isValidTenantName } from '@odudu/domain-tenant';
import { consoleLoginRepository } from '#/repository/console-logins';
import { tenantDirectory } from '#/repository/tenants';
import { codeChallenge, codeVerifier } from '#/service/pkce';
import { safeReturnTo } from '#/service/return-to';
import { bindToTenant, randomSecret, sha256 } from '#/service/secrets';
import { CONSOLE_LOGIN_SECONDS } from '#/service/session-lifetime';

export const CALLBACK_PATH = '/console/auth/callback';

export interface LoginDeps {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly base: URL;
}

export interface BeginLogin {
  readonly tenant: string | undefined;
  readonly returnTo: string | undefined;
  readonly now: Date;
}

export type BeginLoginResult =
  | { readonly kind: 'redirect'; readonly location: string; readonly state: string }
  | { readonly kind: 'refused' };

export function callbackUri(base: URL): string {
  return new URL(CALLBACK_PATH, base).toString();
}

export async function beginLogin(deps: LoginDeps, input: BeginLogin): Promise<BeginLoginResult> {
  const tenant = input.tenant;
  if (tenant === undefined || !isValidTenantName(tenant)) return { kind: 'refused' };
  const tenantId = await tenantDirectory(deps.ownerDatabase.db).idByName(tenant);
  if (tenantId === null) return { kind: 'refused' };

  const state = bindToTenant(tenantId, randomSecret());
  const verifier = codeVerifier();
  const nonce = randomSecret();
  await withTenant(deps.database.db, tenantId, (tx) =>
    consoleLoginRepository(tx).create({
      tenantId,
      stateHash: sha256(state),
      verifierWrapped: wrapSecret(verifier, deps.kek),
      nonce,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(input.now.getTime() + CONSOLE_LOGIN_SECONDS * 1000),
    }),
  );

  // Absolute on the public base, so the browser's own authorization
  // request carries the authority the gateway later injects with.
  const authorize = new URL(`/tenants/${tenant}/protocol/openid-connect/auth`, deps.base);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: ADMIN_CLIENT_ID,
    redirect_uri: callbackUri(deps.base),
    scope: 'openid',
    resource: ADMIN_API_AUDIENCE,
    state,
    nonce,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return { kind: 'redirect', location: authorize.toString(), state };
}
