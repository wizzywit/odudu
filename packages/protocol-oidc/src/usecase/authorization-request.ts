import { type ClientRecord } from '@odudu/domain-realm';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { type RealmLookup } from '#/repository/realm-lookup';
import {
  validateAuthorizationRequest,
  type AuthorizeOutcome,
} from '#/service/authorize-validation';

export type AuthorizationRequestOutcome =
  | { kind: 'render'; error: string; description: string }
  | { kind: 'redirect'; redirectUri: string; error: string; state: string | null }
  | { kind: 'started'; authSessionId: string };

export interface ResolvedClient {
  client: ClientRecord | null;
  config: ClientOidcConfig | null;
}

export interface AuthorizeUsecaseDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // Scoped to the resolved realm by the caller composing this dependency
  // (index.ts), the same way listPublishableKeys is for the JWKS route.
  resolveClient(realmId: string, oauthClientId: string): Promise<ResolvedClient>;
  startAuthentication(
    realmId: string,
    request: Extract<AuthorizeOutcome, { kind: 'ok' }>['request'],
  ): Promise<{ authSessionId: string }>;
}

// An unknown or disabled realm is indistinguishable from an unknown or
// disabled client for the same reason discovery and JWKS already treat them
// that way: there is no client to trust a redirect_uri against, so this
// renders exactly like the client half of the §4.1.2.1 boundary rather than
// inventing a second error path.
export async function handleAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realmName: string,
  params: Record<string, string | undefined>,
): Promise<AuthorizationRequestOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) {
    const outcome = validateAuthorizationRequest(params, null, null);
    if (outcome.kind === 'ok') {
      throw new Error(
        'unreachable: validateAuthorizationRequest cannot succeed with a null client',
      );
    }
    return outcome;
  }

  const oauthClientId = params.client_id;
  const resolved: ResolvedClient =
    oauthClientId === undefined
      ? { client: null, config: null }
      : await deps.resolveClient(realm.id, oauthClientId);

  const outcome = validateAuthorizationRequest(params, resolved.client, resolved.config);
  if (outcome.kind !== 'ok') return outcome;

  const { authSessionId } = await deps.startAuthentication(realm.id, outcome.request);
  return { kind: 'started', authSessionId };
}
