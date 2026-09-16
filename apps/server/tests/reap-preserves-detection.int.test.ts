import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { capturingSender } from '@odudu/email';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { reap, retentionPolicyFromConfig, type ReapOutcome } from '#/cli/reap';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// `DELETE … WHERE expires_at < now()` passes every test that asserts a
// replayed credential was refused: the broken implementation refuses it
// too, with the same invalid_grant, having simply failed to notice it was a
// replay. Each case here asserts the consequence instead — that the family
// was revoked, and that the rows detection reads were still there to read —
// which is the only thing that distinguishes the two.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/cb';
const PASSWORD = 'correct horse battery';
// RFC 7636 Appendix B's worked example, as every other authorization-code
// integration test in this repository uses.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// Long enough that a replay in this test still arrives inside it, short
// enough that a naive pass measuring `expires_at` against the `now` below
// has both tokens of the family to delete. Without it the default is
// fourteen days and the naive implementation deletes nothing, which is how
// a trap test comes out green against the very code it exists to catch.
const REFRESH_TTL_SECONDS = 600;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');

  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  http = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    sender: capturingSender(),
  });
  await http.ready();
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await http.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function provisionRealm(): Promise<string> {
  const realm = `reap-detect-${newId()}`;
  await seed(['realm', '--name', realm]);
  await seed([
    'client',
    '--realm',
    realm,
    '--client-id',
    'app',
    '--public',
    '--redirect-uri',
    REDIRECT_URI,
  ]);
  await seed([
    'user',
    '--realm',
    realm,
    '--username',
    'ada',
    '--password',
    PASSWORD,
    '--email',
    'ada@example.test',
  ]);

  await owner.db.execute(sql`
    UPDATE client_oidc_config SET refresh_token_ttl_seconds = ${REFRESH_TTL_SECONDS}
     WHERE realm_id = (SELECT id FROM realms WHERE name = ${realm})
  `);
  return realm;
}

interface RedeemedCode {
  readonly code: string;
  readonly refreshToken: string;
}

// The real browser path: /authorize for the login form, the form submission
// for the code, then a PKCE exchange at /token. The code is returned
// alongside the tokens so a later replay presents the same string a client
// would have kept.
async function completeCodeFlow(realm: string): Promise<RedeemedCode> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'app',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz-123',
    nonce: 'n-0S6_WzA2Mj',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const form = await http.inject({
    url: `/realms/${realm}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const authSessionId = /name="auth_session_id" value="([^"]*)"/.exec(form.body)?.[1];
  if (authSessionId === undefined) throw new Error('no auth_session_id in the login form');

  const loginRes = await http.inject({
    method: 'POST',
    url: `/realms/${realm}/login-actions/authenticate`,
    payload: new URLSearchParams({
      auth_session_id: authSessionId,
      username: 'ada',
      password: PASSWORD,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const location = loginRes.headers.location;
  const code = typeof location === 'string' ? /[?&]code=([^&]*)/.exec(location)?.[1] : undefined;
  if (code === undefined) throw new Error(`no code in redirect: ${String(location)}`);

  const tokenRes = await redeemCode(realm, code);
  expect(tokenRes.statusCode).toBe(200);
  const body = tokenRes.json<{ refresh_token?: string }>();
  if (body.refresh_token === undefined) {
    throw new Error('expected the authorization_code grant to issue a refresh token');
  }
  return { code, refreshToken: body.refresh_token };
}

function redeemCode(realm: string, code: string) {
  return http.inject({
    method: 'POST',
    url: `/realms/${realm}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: 'app',
      code_verifier: VERIFIER,
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

function presentRefreshToken(realm: string, token: string) {
  return http.inject({
    method: 'POST',
    url: `/realms/${realm}/protocol/openid-connect/token`,
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: 'app',
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// Two hours on from the flow: past every window a credential's own
// `expires_at` defines, and nowhere near the grant family's retention.
function reapEverythingEligible(): Promise<ReapOutcome> {
  const now = new Date(Date.now() + TWO_HOURS_MS);
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  return reap({ database: appDb, ownerDatabase: owner }, now, retentionPolicyFromConfig(config));
}

// Ordered, and the caller asserts there is exactly one: a flow that grew a
// second grant would otherwise have this pick between them arbitrarily.
async function grantsOf(realm: string): Promise<{ id: string; revoked: boolean }[]> {
  const rows = await owner.db.execute<{ id: string; revoked: boolean }>(sql`
    SELECT g.id, g.revoked_at IS NOT NULL AS revoked
      FROM token_grants g JOIN realms r ON r.id = g.realm_id
     WHERE r.name = ${realm}
     ORDER BY g.created_at, g.id
  `);
  return [...rows];
}

async function countIn(realm: string, table: 'refresh_tokens' | 'authorization_codes') {
  const relation = table === 'refresh_tokens' ? sql`refresh_tokens` : sql`authorization_codes`;
  const rows = await owner.db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM ${relation} t
      JOIN realms r ON r.id = t.realm_id
     WHERE r.name = ${realm}
  `);
  return Number(rows[0]?.n ?? '-1');
}

describe('reaping does not break reuse detection', () => {
  it('still detects a replayed refresh token and revokes its family', async () => {
    const realm = await provisionRealm();
    const { refreshToken } = await completeCodeFlow(realm);

    const rotated = await presentRefreshToken(realm, refreshToken);
    expect(rotated.statusCode).toBe(200);
    const nextToken = rotated.json<{ refresh_token: string }>().refresh_token;

    const outcome = await reapEverythingEligible();
    if (!outcome.ran) throw new Error('the pass did not run');

    // The rows reuse detection reads are still there. A pass keyed on
    // `expires_at` would have taken both of them, and every assertion
    // below except the revocation would still have held.
    expect(outcome.deleted.refresh_tokens).toBe(0);
    expect(await countIn(realm, 'refresh_tokens')).toBe(2);

    const replay = await presentRefreshToken(realm, refreshToken);
    expect(replay.statusCode).toBe(400);
    expect(replay.json<{ error: string }>().error).toBe('invalid_grant');

    const grants = await grantsOf(realm);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.revoked).toBe(true);

    // The replacement must be dead too, which is what "revokes the family"
    // means and what a bare refusal would not have achieved.
    const successor = await presentRefreshToken(realm, nextToken);
    expect(successor.statusCode).toBe(400);
    expect(successor.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('still revokes the grant behind a replayed authorization code', async () => {
    const realm = await provisionRealm();
    const { code } = await completeCodeFlow(realm);

    const outcome = await reapEverythingEligible();
    if (!outcome.ran) throw new Error('the pass did not run');

    // The consumed code outlives its own 60-second expiry because the
    // family it produced is young. It is the only record of which grant a
    // replay must revoke (RFC 6749 §4.1.2).
    expect(outcome.deleted.authorization_codes).toBe(0);
    expect(await countIn(realm, 'authorization_codes')).toBe(1);

    const replay = await redeemCode(realm, code);
    expect(replay.statusCode).toBe(400);
    expect(replay.json<{ error: string }>().error).toBe('invalid_grant');

    const grants = await grantsOf(realm);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.revoked).toBe(true);
  });
});
