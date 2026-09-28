import { type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { FakeClock, loadConfig, newId } from '@odudu/kernel';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { expect } from 'vitest';
import { buildApp } from '#/app';
import { seedAdmin } from '#/cli/seed';
import { createLogger } from '#/logger';

// A browser for the console's integration tests: it drives the gateway's
// redirect, the server's own login form and forced password change, and
// the callback back into the gateway, all through `inject`.

export const KEK = Buffer.alloc(32, 7);
export const NEW_PASSWORD = 'Str0ng-Passw0rd!42';
export const RETURN_TO = '/console/tenants/system/clients?page=2';

export interface ConsoleDatabases {
  readonly database: DatabaseHandle;
  readonly ownerDatabase: DatabaseHandle;
}

export interface ConsoleStack {
  readonly app: FastifyInstance;
  readonly clock: FakeClock;
  readonly logs: string[];
  // Every /token response body the server sent, the gateway's included.
  readonly tokenResponses: string[];
  readonly base: URL;
}

export async function startConsoleApp(
  databases: ConsoleDatabases,
  base: string,
): Promise<ConsoleStack> {
  const logs: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'trace' });
  const clock = new FakeClock(new Date());
  const baseUrl = new URL(base);
  const app = buildApp({
    ...databases,
    kek: KEK,
    logger: createLogger(config, destination),
    publicBaseUrl: base,
    consoleBaseUrl: base,
    consoleNow: () => clock.now(),
    // An https base is served behind a proxy: boot refuses it otherwise.
    trustProxy: baseUrl.protocol === 'https:',
  });
  const tokenResponses: string[] = [];
  app.addHook('onSend', async (request, _reply, payload) => {
    if (request.url.endsWith('/protocol/openid-connect/token') && typeof payload === 'string') {
      tokenResponses.push(payload);
    }
    return payload;
  });
  await app.ready();
  return { app, clock, logs, tokenResponses, base: baseUrl };
}

export class Jar {
  readonly cookies = new Map<string, string>();

  take(res: LightMyRequestResponse): void {
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  header(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  }
}

// What a TLS-terminating proxy in front of an https base would add.
function forwarded(stack: ConsoleStack): Record<string, string> {
  return stack.base.protocol === 'https:' ? { 'x-forwarded-proto': 'https' } : {};
}

export async function browse(
  stack: ConsoleStack,
  jar: Jar,
  url: string,
  host = stack.base.host,
): Promise<LightMyRequestResponse> {
  const res = await stack.app.inject({
    url,
    headers: { host, ...forwarded(stack), ...jar.header() },
  });
  jar.take(res);
  return res;
}

export async function post(
  stack: ConsoleStack,
  jar: Jar,
  url: string,
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  const res = await stack.app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: {
      host: stack.base.host,
      ...forwarded(stack),
      'content-type': 'application/x-www-form-urlencoded',
      ...jar.header(),
    },
  });
  jar.take(res);
  return res;
}

export function field(body: string, name: string): string {
  const value = new RegExp(`name="${name}" value="([^"]*)"`, 'u').exec(body)?.[1];
  if (value === undefined) throw new Error(`${name} not found`);
  return value;
}

export function pathOf(stack: ConsoleStack, location: string): string {
  const url = new URL(location, stack.base);
  return url.pathname + url.search;
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export async function beginLogin(
  stack: ConsoleStack,
  jar: Jar,
  host = stack.base.host,
): Promise<{ authorize: URL; state: string }> {
  const query = new URLSearchParams({ tenant: SYSTEM_TENANT_NAME, return_to: RETURN_TO });
  const res = await browse(stack, jar, `/console/auth/login?${query.toString()}`, host);
  expect(res.statusCode).toBe(302);
  const authorize = new URL(String(res.headers.location));
  return { authorize, state: authorize.searchParams.get('state') ?? '' };
}

export interface SignedInAtOp {
  readonly callback: string;
  readonly subjectId: string;
  readonly username: string;
}

// Signs a freshly seeded administrator in at the server's own login form,
// through its forced password change, and answers the callback URL the
// authorization endpoint redirected to.
export async function signInAtOp(
  stack: ConsoleStack,
  jar: Jar,
  authorize: URL,
): Promise<SignedInAtOp> {
  const username = `ada-${newId()}`;
  const { password, subjectId } = await seedAdmin({ username });
  const page = await browse(stack, jar, authorize.pathname + authorize.search);
  const actions = `/tenants/${SYSTEM_TENANT_NAME}/login-actions`;
  const first = await post(stack, jar, `${actions}/authenticate`, {
    auth_session_id: field(page.body, 'auth_session_id'),
    username,
    password,
  });
  const changed = await post(stack, jar, `${actions}/required-action?action=update-password`, {
    auth_session_id: field(first.body, 'auth_session_id'),
    password: NEW_PASSWORD,
  });
  const signedIn = await post(stack, jar, `${actions}/authenticate`, {
    auth_session_id: field(changed.body, 'auth_session_id'),
    username,
    password: NEW_PASSWORD,
  });
  expect(signedIn.statusCode).toBe(302);
  const callback = String(signedIn.headers.location);
  expect(callback.startsWith(`${new URL('/console/auth/callback', stack.base).toString()}?`)).toBe(
    true,
  );
  return { callback, subjectId, username };
}

/** A full sign-in: login, the OP's form, and the callback, leaving the session cookie in `jar`. */
export async function signIn(
  stack: ConsoleStack,
  jar: Jar,
): Promise<SignedInAtOp & { readonly response: LightMyRequestResponse }> {
  const { authorize } = await beginLogin(stack, jar);
  const signed = await signInAtOp(stack, jar, authorize);
  const response = await browse(stack, jar, pathOf(stack, signed.callback));
  expect(response.statusCode).toBe(302);
  return { ...signed, response };
}
