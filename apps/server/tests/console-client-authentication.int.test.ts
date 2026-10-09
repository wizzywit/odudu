import { generateClientKey, loadClientKey, signClientAssertion } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { ADMIN_API_AUDIENCE, ADMIN_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { createHash } from 'node:crypto';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import {
  type ConsoleStack,
  Jar,
  KEK,
  post,
  signInAtOp,
  startConsoleApp,
} from '#/testing/console-harness';
import { CONSOLE_CLIENT_KEY, CONSOLE_KEYS } from '#/testing/console-key';

// The built-in admin client is confidential: a code or a refresh token is
// worth nothing at /token or /revoke without the gateway's signed assertion.
// Each case here presents the real client's credentials to the real endpoints.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';
const REDIRECT_URI = `${BASE}/console/auth/callback`;
const TOKEN_ENDPOINT = `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/token`;
const REVOKE_ENDPOINT = `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/revoke`;
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
  await appDb.close();
  await owner.close();
  await container.stop();
});

async function assertionWith(
  key = CONSOLE_KEYS.key,
  audience = `${BASE}${TOKEN_ENDPOINT}`,
): Promise<Record<string, string>> {
  return {
    client_assertion_type: ASSERTION_TYPE,
    client_assertion: await signClientAssertion(key, {
      clientId: ADMIN_CLIENT_ID,
      audience,
      now: new Date(),
    }),
  };
}

// An authorization code the browser holds, obtained with a verifier of this
// test's own so it can be redeemed without going through the gateway.
async function authorizationCode(stack: ConsoleStack): Promise<string> {
  const authorize = new URL(`${BASE}/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/auth`);
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: ADMIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    resource: ADMIN_API_AUDIENCE,
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  })) {
    authorize.searchParams.set(name, value);
  }
  const { callback } = await signInAtOp(stack, new Jar(), authorize);
  const code = new URL(callback).searchParams.get('code');
  if (code === null) throw new Error('no code in the callback');
  return code;
}

function redeem(code: string, auth: Record<string, string>, stack: ConsoleStack) {
  return post(stack, new Jar(), TOKEN_ENDPOINT, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: ADMIN_CLIENT_ID,
    code_verifier: VERIFIER,
    ...auth,
  });
}

function expectInvalidClient(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(401);
  expect(res.json<{ error: string }>().error).toBe('invalid_client');
}

describe('the built-in admin client at the token and revocation endpoints', () => {
  it('redeems a code only with the gateway’s assertion, and refuses every other presentation first', async () => {
    const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
    const code = await authorizationCode(stack);

    expectInvalidClient(await redeem(code, {}, stack));
    const stranger = await loadClientKey(await generateClientKey());
    expectInvalidClient(await redeem(code, await assertionWith(stranger), stack));
    expectInvalidClient(
      await redeem(
        code,
        await assertionWith(
          CONSOLE_KEYS.key,
          `${BASE}/tenants/another/protocol/openid-connect/token`,
        ),
        stack,
      ),
    );

    // The refusals above spent nothing: the same code still redeems.
    const redeemed = await redeem(code, await assertionWith(), stack);
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json<{ refresh_token: string }>()).toHaveProperty('refresh_token');
  });

  it('refuses a refresh and a revocation that carry no assertion, and accepts them with one', async () => {
    const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
    const code = await authorizationCode(stack);
    const { refresh_token: refreshToken } = (
      await redeem(code, await assertionWith(), stack)
    ).json<{ refresh_token: string }>();

    const refresh = (auth: Record<string, string>) =>
      post(stack, new Jar(), TOKEN_ENDPOINT, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: ADMIN_CLIENT_ID,
        resource: ADMIN_API_AUDIENCE,
        ...auth,
      });
    const revoke = (auth: Record<string, string>) =>
      post(stack, new Jar(), REVOKE_ENDPOINT, {
        token: refreshToken,
        token_type_hint: 'refresh_token',
        client_id: ADMIN_CLIENT_ID,
        ...auth,
      });

    expectInvalidClient(await refresh({}));
    expectInvalidClient(await revoke({}));

    // Neither refusal touched the token: a signed revocation ends it.
    expect((await revoke(await assertionWith())).statusCode).toBe(200);
    const afterRevoke = await refresh(await assertionWith());
    expect(afterRevoke.statusCode).toBe(400);
    expect(afterRevoke.json<{ error: string }>().error).toBe('invalid_grant');
  });
});
