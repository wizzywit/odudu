import { createHmac } from 'node:crypto';
import path from 'node:path';
import { BASE } from './page-inspection';
import { inTenant, psql, seed, sqlText } from './stack';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// A path the stack answers, so a finished sign-in lands somewhere that loads.
export const ROOT = path.resolve(import.meta.dirname, '../../..');

export const LONG_NAME =
  'The International Consortium of Extraordinarily Long Named Organisations and Their Subsidiary Applications Incorporated';

export const LANDING = `${BASE}/health/ready`;

export function authorize(
  tenant: string,
  client: string,
  extra: Record<string, string> = {},
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client,
    redirect_uri: LANDING,
    scope: 'openid profile',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 6238 with the SHA-1, six digits and thirty seconds the enrolment page asks for.
export function totp(secret: string, at = Date.now()): string {
  const bits = secret
    .replace(/=+$/u, '')
    .split('')
    .map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from((bits.match(/.{8}/gu) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = (hash[19] ?? 0) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function client(tenant: string, id: string, name: string): void {
  seed(['client', '--tenant', tenant, '--client-id', id, '--public', '--redirect-uri', LANDING]);
  psql(
    `update clients set name = ${sqlText(name)} where client_id = ${sqlText(id)} and tenant_id = ${inTenant(tenant)}`,
  );
}

// The query of the link a mail carries: the key and, when the request had one, the way back.
export function mailKey(tenant: string, to: string): string {
  return psql(
    `select substring(o.body_text from 'key=([A-Za-z0-9_%.&=-]+)') from email_outbox o where o.tenant_id = ${inTenant(tenant)} and o.to_address = ${sqlText(to)} order by o.created_at desc limit 1`,
  );
}
