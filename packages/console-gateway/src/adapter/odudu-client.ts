import { type ClientKey, signClientAssertion } from '@odudu/crypto';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID } from '@odudu/domain-tenant';
import { z } from 'zod';
import {
  type AdminCall,
  type AdminResponse,
  type Caller,
  type CodeExchange,
  type DiscoveryDocument,
  type JsonWebKeySet,
  type OduduPort,
  type RefreshOutcome,
  type TokenSet,
} from '#/service/odudu-port';

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// Loose: the console shows every field the public document carries, not
// only the ones the gateway itself reads.
const DISCOVERY = z.looseObject({ issuer: z.string().min(1) });
const JWKS = z.looseObject({ keys: z.array(z.record(z.string(), z.unknown())) });

const TOKEN_RESPONSE = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const REFRESH_RESPONSE = TOKEN_RESPONSE.omit({ id_token: true });

const TOKEN_ERROR = z.object({ error: z.string() });

function json(res: LightMyRequestResponse): unknown {
  try {
    const value: unknown = JSON.parse(res.body);
    return value;
  } catch {
    return null;
  }
}

// The issuer is derived from each request's own authority, so every call
// carries the public base's and never the browser's: that is what keeps the
// callback's iss, the ID token's iss and the admin API's issuer check on
// one string. The forwarded pair is read only while ODUDU_TRUST_PROXY is
// on, which boot requires for an https base.
export interface ClientAuthentication {
  /** The key every tenant's admin client is registered with. */
  readonly key: ClientKey;
  readonly now: () => Date;
}

// The gateway is a confidential client: every request that names
// `odudu-admin` at the token or revocation endpoint carries an assertion
// (RFC 7523) signed with the one key registered on every tenant. The
// audience is the tenant's token endpoint at all three, the one value the
// server accepts.
export function oduduClient(
  fastify: FastifyInstance,
  base: URL,
  authentication: ClientAuthentication,
): OduduPort {
  const authority = {
    host: base.host,
    'x-forwarded-host': base.host,
    'x-forwarded-proto': base.protocol.slice(0, -1),
  };
  // The browser's request id, so the server's audit rows and problem
  // instances name the id the browser was answered with.
  const headersFor = (from: Caller): Record<string, string> => ({
    ...authority,
    'x-request-id': from.requestId,
  });
  const tenantPath = (tenant: string): string => `/tenants/${encodeURIComponent(tenant)}`;
  async function clientAuthentication(tenant: string): Promise<Record<string, string>> {
    const assertion = await signClientAssertion(authentication.key, {
      clientId: ADMIN_CLIENT_ID,
      audience: `${base.origin}${tenantPath(tenant)}/protocol/openid-connect/token`,
      now: authentication.now(),
    });
    return { client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: assertion };
  }

  async function discoveryOf(tenant: string, from: Caller): Promise<DiscoveryDocument | null> {
    const res = await fastify.inject({
      method: 'GET',
      url: `${tenantPath(tenant)}/.well-known/openid-configuration`,
      headers: headersFor(from),
      remoteAddress: from.ip,
    });
    if (res.statusCode !== 200) return null;
    const parsed = DISCOVERY.safeParse(json(res));
    return parsed.success ? parsed.data : null;
  }

  return {
    async issuerOf(tenant: string, from: Caller): Promise<string | null> {
      const doc = await discoveryOf(tenant, from);
      return doc?.issuer ?? null;
    },

    discoveryOf,

    async keysOf(tenant: string, from: Caller): Promise<JsonWebKeySet | null> {
      const res = await fastify.inject({
        method: 'GET',
        url: `${tenantPath(tenant)}/protocol/openid-connect/certs`,
        headers: headersFor(from),
        remoteAddress: from.ip,
      });
      if (res.statusCode !== 200) return null;
      const parsed = JWKS.safeParse(json(res));
      return parsed.success ? parsed.data : null;
    },

    async exchangeCode(input: CodeExchange): Promise<TokenSet | null> {
      const res = await fastify.inject({
        method: 'POST',
        url: `${tenantPath(input.tenant)}/protocol/openid-connect/token`,
        headers: { ...headersFor(input.from), 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: input.from.ip,
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: ADMIN_CLIENT_ID,
          code_verifier: input.verifier,
          resource: ADMIN_API_AUDIENCE,
          ...(await clientAuthentication(input.tenant)),
        }).toString(),
      });
      if (res.statusCode !== 200) return null;
      const parsed = TOKEN_RESPONSE.safeParse(json(res));
      if (!parsed.success) return null;
      return {
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token,
        idToken: parsed.data.id_token,
        expiresInSeconds: parsed.data.expires_in,
      };
    },

    async revoke(tenant: string, refreshToken: string, from: Caller): Promise<void> {
      await fastify.inject({
        method: 'POST',
        url: `${tenantPath(tenant)}/protocol/openid-connect/revoke`,
        headers: { ...headersFor(from), 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: from.ip,
        payload: new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: ADMIN_CLIENT_ID,
          ...(await clientAuthentication(tenant)),
        }).toString(),
      });
    },

    async refresh(tenant: string, refreshToken: string, from: Caller): Promise<RefreshOutcome> {
      const res = await fastify.inject({
        method: 'POST',
        url: `${tenantPath(tenant)}/protocol/openid-connect/token`,
        headers: { ...headersFor(from), 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: from.ip,
        payload: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: ADMIN_CLIENT_ID,
          resource: ADMIN_API_AUDIENCE,
          ...(await clientAuthentication(tenant)),
        }).toString(),
      });
      if (
        res.statusCode === 400 &&
        TOKEN_ERROR.safeParse(json(res)).data?.error === 'invalid_grant'
      ) {
        return { kind: 'refused' };
      }
      if (res.statusCode !== 200) return { kind: 'failed' };
      // A 200 has rotated the refresh token whether or not its body can be
      // read, so the stored one is spent and presenting it would revoke.
      const parsed = REFRESH_RESPONSE.safeParse(json(res));
      if (!parsed.success) return { kind: 'refused' };
      return {
        kind: 'refreshed',
        tokens: {
          accessToken: parsed.data.access_token,
          refreshToken: parsed.data.refresh_token,
          expiresInSeconds: parsed.data.expires_in,
        },
      };
    },

    async forward(call: AdminCall): Promise<AdminResponse> {
      const res = await fastify.inject({
        method: call.method,
        url: call.path,
        headers: { ...call.headers, ...headersFor(call.from) },
        remoteAddress: call.from.ip,
        ...(call.body === undefined ? {} : { payload: call.body }),
      });
      return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
    },
  };
}
