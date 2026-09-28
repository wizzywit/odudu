import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID } from '@odudu/domain-tenant';
import { z } from 'zod';
import {
  type AdminCall,
  type AdminResponse,
  type CodeExchange,
  type OduduPort,
  type RefreshOutcome,
  type TokenSet,
} from '#/service/odudu-port';

const DISCOVERY = z.object({ issuer: z.string().min(1) });

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
export function oduduClient(fastify: FastifyInstance, base: URL): OduduPort {
  const authority = {
    host: base.host,
    'x-forwarded-host': base.host,
    'x-forwarded-proto': base.protocol.slice(0, -1),
  };
  const tenantPath = (tenant: string): string => `/tenants/${encodeURIComponent(tenant)}`;

  return {
    async issuerOf(tenant: string, ip: string): Promise<string | null> {
      const res = await fastify.inject({
        method: 'GET',
        url: `${tenantPath(tenant)}/.well-known/openid-configuration`,
        headers: authority,
        remoteAddress: ip,
      });
      if (res.statusCode !== 200) return null;
      const parsed = DISCOVERY.safeParse(json(res));
      return parsed.success ? parsed.data.issuer : null;
    },

    async keysOf(tenant: string, ip: string): Promise<unknown> {
      const res = await fastify.inject({
        method: 'GET',
        url: `${tenantPath(tenant)}/protocol/openid-connect/certs`,
        headers: authority,
        remoteAddress: ip,
      });
      return res.statusCode === 200 ? json(res) : null;
    },

    async exchangeCode(input: CodeExchange): Promise<TokenSet | null> {
      const res = await fastify.inject({
        method: 'POST',
        url: `${tenantPath(input.tenant)}/protocol/openid-connect/token`,
        headers: { ...authority, 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: input.ip,
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: ADMIN_CLIENT_ID,
          code_verifier: input.verifier,
          resource: ADMIN_API_AUDIENCE,
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

    async revoke(tenant: string, refreshToken: string, ip: string): Promise<void> {
      await fastify.inject({
        method: 'POST',
        url: `${tenantPath(tenant)}/protocol/openid-connect/revoke`,
        headers: { ...authority, 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: ip,
        payload: new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: ADMIN_CLIENT_ID,
        }).toString(),
      });
    },

    async refresh(tenant: string, refreshToken: string, ip: string): Promise<RefreshOutcome> {
      const res = await fastify.inject({
        method: 'POST',
        url: `${tenantPath(tenant)}/protocol/openid-connect/token`,
        headers: { ...authority, 'content-type': 'application/x-www-form-urlencoded' },
        remoteAddress: ip,
        payload: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: ADMIN_CLIENT_ID,
          resource: ADMIN_API_AUDIENCE,
        }).toString(),
      });
      if (
        res.statusCode === 400 &&
        TOKEN_ERROR.safeParse(json(res)).data?.error === 'invalid_grant'
      ) {
        return { kind: 'refused' };
      }
      if (res.statusCode !== 200) return { kind: 'failed' };
      const parsed = REFRESH_RESPONSE.safeParse(json(res));
      if (!parsed.success) return { kind: 'failed' };
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
        headers: { ...call.headers, ...authority },
        remoteAddress: call.ip,
        ...(call.body === undefined ? {} : { payload: call.body }),
      });
      return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
    },
  };
}
