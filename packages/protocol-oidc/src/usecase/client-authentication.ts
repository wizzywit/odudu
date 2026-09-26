import { type TenantScopedDatabase } from '@odudu/db';
import { clientRepository, verifyClientSecret, type ClientRecord } from '@odudu/domain-tenant';
import { clientOidcConfigRepository, type ClientOidcConfig } from '#/repository/client-oidc-config';
import {
  clientSecretLimiterKey,
  isPasswordAuthMethod,
  type ClientSecretLimiter,
} from '#/service/client-secret-throttle';
import { invalidClient, TokenError, TokenRateLimited, withAudit } from '#/service/errors';

export interface RefusalLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

// Every caller of `authenticateClient` — `/token` and `/introspect` alike —
// authenticates a registered OAuth client the same way, against the same
// ADR 0023 budget, so this is the one place either endpoint needs.
export interface ClientAuthenticationDeps {
  readonly tenantId: string;
  verifyPassword: (hash: string, secret: string) => Promise<boolean>;
  // ADR 0023's client half: a per-`client_id` budget on failed
  // client_secret_basic/client_secret_post attempts, consulted by
  // `authenticateClient` and by nothing else. The concrete instance wraps
  // `apps/server/src/throttle.ts`'s `slidingWindow`; protocol-oidc only
  // ever sees the shape.
  clientSecretLimiter: ClientSecretLimiter;
  logger: RefusalLogger;
}

export interface BasicCredentials {
  clientId: string;
  secret: string;
}

// `realm` is RFC 7235 §4.1's auth-param name, not this project's word.
export const WWW_AUTHENTICATE = 'Basic realm="token"';

// RFC 6749 §3.2: a parameter sent with an empty value is treated as if it
// had been omitted, so `client_secret=` must not count as a second
// authentication method being presented alongside Basic. Shared by every
// body field a client-authenticated endpoint reads this way, not only
// `client_id`/`client_secret`.
export function readOptionalField(
  body: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// RFC 6749 §2.3.1 encodes each half with
// `application/x-www-form-urlencoded` before joining them, so decoding is
// what lets a secret containing `:` — the separator itself — or `%` survive
// the round trip. `decodeURIComponent` raises `URIError` on a sequence like
// `%` or `%zz`, and such bytes are not a form-urlencoding at all: they hold
// no client identifier and no secret to recover. Falling back to them
// undecoded, as some servers do for clients that never encoded, would leave
// one registered secret with two accepted spellings on the wire.
function decodeBasicCredentials(payload: string): BasicCredentials | undefined {
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      secret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}

// RFC 6749 §2.3.1: `Authorization: Basic base64(client_id:client_secret)`.
// A header naming another scheme presents no client credential — a bearer
// token here is not client authentication — and is left to the body. A
// header that names `Basic` and cannot be read is a failed presentation of
// `client_secret_basic`, and fails as one rather than being dropped so the
// body can be tried instead: a client cannot escape §2.3's
// one-method-per-request rule, or a wrong secret, by corrupting its header.
export function parseBasicAuth(header: string | undefined): BasicCredentials | undefined {
  if (header === undefined) return undefined;
  const match = /^Basic(?:\s+(.*))?$/i.exec(header);
  if (match === null) return undefined;

  const credentials = decodeBasicCredentials(match[1] ?? '');
  if (credentials === undefined) throw invalidClient(WWW_AUTHENTICATE);
  return credentials;
}

async function verifyClientCredentials(
  tx: TenantScopedDatabase,
  deps: ClientAuthenticationDeps,
  oauthClientId: string,
  basic: BasicCredentials | undefined,
  bodyClientSecret: string | undefined,
  attemptedMethod: string,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  const client = await clientRepository(tx).byClientId(oauthClientId);
  // No row: a client_id nobody registered names no principal to record
  // against, and a row per guess would be unbounded (ADR 0037).
  if (client === null) {
    deps.logger.warn(
      { tenantId: deps.tenantId, claimedClientId: oauthClientId },
      'client authentication refused for an unregistered client_id',
    );
    throw invalidClient(WWW_AUTHENTICATE);
  }

  const config = await clientOidcConfigRepository(tx).byClientId(client.id);
  if (config === null) throw invalidClient(WWW_AUTHENTICATE);

  const refused = (): TokenError =>
    withAudit(invalidClient(WWW_AUTHENTICATE), {
      action: 'client.authenticate',
      reason: 'bad_credential',
      clientDbId: client.id,
      method: attemptedMethod,
    });

  let presented: string | null;
  if (basic !== undefined) {
    if (config.tokenEndpointAuthMethod !== 'client_secret_basic') throw refused();
    presented = basic.secret;
  } else if (bodyClientSecret !== undefined) {
    if (config.tokenEndpointAuthMethod !== 'client_secret_post') throw refused();
    presented = bodyClientSecret;
  } else {
    presented = null;
  }

  const ok = await verifyClientSecret(client, presented, deps.verifyPassword);
  if (!ok) throw refused();

  return { client, config };
}

// Client authentication, shared by every endpoint that requires it. Every
// failure here — unknown client_id, disabled client, wrong secret, a public
// client presenting a secret, the wrong method, or two methods at once —
// reports the same `invalid_client` (401), never which, and (ADR 0023's
// amendment) is metered against the same per-`client_id` budget. Only the
// `throw` path below ever calls `check`; a healthy client never reaches it.
export async function authenticateClient(
  tx: TenantScopedDatabase,
  deps: ClientAuthenticationDeps,
  basic: BasicCredentials | undefined,
  bodyClientId: string | undefined,
  bodyClientSecret: string | undefined,
): Promise<{ client: ClientRecord; config: ClientOidcConfig }> {
  if (basic !== undefined && bodyClientSecret !== undefined) throw invalidClient(WWW_AUTHENTICATE);

  const oauthClientId = basic?.clientId ?? bodyClientId;
  if (oauthClientId === undefined) throw invalidClient(WWW_AUTHENTICATE);

  // What this request is attempting, from how the credential arrived —
  // never the client's registered method, which an unknown client_id has
  // none of. Basic and a body secret are §2.3.1's two password methods by
  // construction; there is no third presentation either caller accepts
  // today.
  const attemptedMethod =
    basic !== undefined
      ? 'client_secret_basic'
      : bodyClientSecret !== undefined
        ? 'client_secret_post'
        : undefined;

  try {
    return await verifyClientCredentials(
      tx,
      deps,
      oauthClientId,
      basic,
      bodyClientSecret,
      attemptedMethod ?? 'none',
    );
  } catch (err) {
    if (
      err instanceof TokenError &&
      attemptedMethod !== undefined &&
      isPasswordAuthMethod(attemptedMethod)
    ) {
      const decision = deps.clientSecretLimiter.check(
        clientSecretLimiterKey(deps.tenantId, oauthClientId),
      );
      if (!decision.allowed) {
        throw new TokenRateLimited(
          decision.retryAfterSeconds,
          err.audit === undefined ? undefined : { ...err.audit, reason: 'rate_limited' },
        );
      }
    }
    throw err;
  }
}
