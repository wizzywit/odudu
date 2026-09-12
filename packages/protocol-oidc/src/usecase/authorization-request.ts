import { AUDIENCE_UNCHECKED, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { type ClientRecord } from '@odudu/domain-realm';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { type RealmLookup } from '#/repository/realm-lookup';
import {
  validateAuthorizationRequest,
  type AuthorizeOutcome,
} from '#/service/authorize-validation';
import { normalizeAuthorizeQuery } from '#/service/query-normalization';

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
  // The realm's own signing keys, which is the whole of "did this server
  // issue that ID Token?" (OIDC Core §3.1.2.2). The same set /jwks
  // publishes and /userinfo verifies against, so a hint minted with a key
  // that has since rotated out of publication is no longer honoured.
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
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
  rawParams: unknown,
  // This realm's issuer identifier, as the discovery document states it: the
  // `iss` an id_token_hint has to carry to have come from here.
  issuer: string,
): Promise<AuthorizationRequestOutcome> {
  const normalized = normalizeAuthorizeQuery(rawParams);
  if (normalized.kind === 'render') return normalized;
  const { params, repeatedKey } = normalized;

  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) {
    const outcome = validateAuthorizationRequest(params, null, null, repeatedKey);
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

  const outcome = validateAuthorizationRequest(
    params,
    resolved.client,
    resolved.config,
    repeatedKey,
  );
  if (outcome.kind !== 'ok') return outcome;

  // Below the §4.1.2.1 boundary: redirect_uri has been matched against the
  // client's registrations, so everything from here reports by redirecting
  // (OIDC Core §3.1.2.6).
  const { request } = outcome;
  const reject = (error: string): AuthorizationRequestOutcome => ({
    kind: 'redirect',
    redirectUri: request.redirectUri,
    error,
    state: request.state,
  });

  let hintSubject: string | null = null;
  if (outcome.idTokenHint !== null) {
    const subject = await subjectOfIdTokenHint(deps, realm.id, issuer, outcome.idTokenHint);
    if (subject === null) return reject('invalid_request');
    hintSubject = subject;
  }

  // OIDC Core §3.1.2.3: with `prompt=none` the authorization server MUST NOT
  // display any authentication or consent user interface, and MUST return an
  // error if the End-User is not already authenticated. Nothing on this path
  // reads the SSO session cookie — authentication always starts afresh — so
  // no End-User is ever already authenticated here, and `login_required`
  // (§3.1.2.6) is the whole of the behaviour rather than a shortcut through
  // it. Session reuse would turn this into a decision; today it is a fact.
  if (outcome.prompts.has('none')) return reject('login_required');

  const { authSessionId } = await deps.startAuthentication(realm.id, {
    ...request,
    // `prompt=login` needs nothing parked: authentication is unconditional
    // (§3.1.2.3's reauthentication is what this server does for every
    // request). The hint is a different matter — whether the End-User who
    // signs in is the one it identifies can only be judged once they have,
    // which is the login submission, so it travels with the parked request.
    ...(hintSubject !== null ? { idTokenHintSubject: hintSubject } : {}),
  });
  return { kind: 'started', authSessionId };
}

// OIDC Core §3.1.2.2: "the OP MUST validate that it was the issuer of the ID
// Token" — a signature made by one of this realm's keys, over a payload whose
// `iss` is this realm. Returns the subject it identifies, or null for a hint
// this server cannot recognise as its own. `exp` is enforced by verifyJwt,
// so a hint past its expiry is refused rather than accepted as §3.1.2.2's
// SHOULD allows (see the reading note in docs/protocols/oidc-core.md).
async function subjectOfIdTokenHint(
  deps: AuthorizeUsecaseDeps,
  realmId: string,
  issuer: string,
  hint: string,
): Promise<string | null> {
  const keys = await deps.listPublishableKeys(realmId);
  try {
    // An ID token's `aud` is the client it was issued to, so the OP reading
    // one back as a hint is not the principal RFC 7519 §4.1.3 addresses and
    // has no audience of its own to match. §3.1.2.2 asks only that the OP
    // was its issuer, which `issuer` and the realm's own keys settle.
    const payload = await verifyJwt(hint, {
      keys,
      issuer,
      audience: AUDIENCE_UNCHECKED,
      // An ID Token has no `typ` of its own — OIDC Core §2 defines none and
      // the ones /token issues carry none — so the honest demand is not
      // "must be an ID Token" but "must not be an access token", which RFC
      // 9068 §2.1's `at+jwt` names exactly. /userinfo makes the mirror image
      // of this check of the token presented to it.
      typ: { refused: 'at+jwt' },
    });
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}
