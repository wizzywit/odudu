import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { users } from '@odudu/domain-identity';
import { clientScopes } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// The rest of this phase's tests each drive one repository or one route.
// This one drives the seed CLI end to end — the seven commands an operator
// actually types to go from an empty database to a token carrying a role —
// because that sequence is the phase's real exit criterion, not any single
// repository method along the way.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/cb';
// RFC 7636 Appendix B's worked example, the same pair every other
// authorization-code int test in this repository uses.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

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

async function extractAuthSessionId(tenantName: string, clientId: string, scope: string) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'xyz-123',
    nonce: 'n-0S6_WzA2Mj',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const res = await http.inject({
    url: `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

interface TokenSet {
  access_token: string;
  id_token?: string;
}

// Drives the real HTTP surface the way a browser and an SPA would: the
// login form for the auth code, then a PKCE token exchange for it — the
// seed CLI provisions the state this walks through, but never the tokens
// themselves.
async function completeCodeFlow(input: {
  clientId: string;
  scope: string;
  tenantName?: string;
  username?: string;
  password?: string;
}): Promise<TokenSet> {
  const tenantName = input.tenantName ?? 'demo';
  const username = input.username ?? 'ada';
  const password = input.password ?? 'correct horse battery';

  const authSessionId = await extractAuthSessionId(tenantName, input.clientId, input.scope);
  const loginForm = new URLSearchParams({ auth_session_id: authSessionId, username, password });
  const loginRes = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: loginForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const location = loginRes.headers.location;
  const code = typeof location === 'string' ? /[?&]code=([^&]*)/.exec(location)?.[1] : undefined;
  if (code === undefined) throw new Error(`no code in redirect: ${String(location)}`);

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: input.clientId,
    code_verifier: VERIFIER,
  });
  const tokenRes = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/token`,
    payload: tokenForm.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(tokenRes.statusCode).toBe(200);
  return tokenRes.json<TokenSet>();
}

// Decodes without verifying: used only to read what issuance minted, never
// to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('the seed CLI, provisioning the identity model it now has', () => {
  it('provisions a tenant whose user can obtain a token carrying a role', async () => {
    const tenantName = `demo-${newId()}`;

    await seed(['tenant', '--name', tenantName]);
    await seed([
      'client',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--public',
      '--redirect-uri',
      REDIRECT_URI,
      '--web-origin',
      'https://app.example',
    ]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
      '--email',
      'ada@example.test',
    ]);
    // `roles` itself is a tenant-default scope: `seed client` already
    // assigned it to `app` via provisionClientDefaults, so mapping straight
    // to it would leave assign-scope doing nothing a removed step would
    // reveal. Mapping to a scope of the tenant's own instead — created here,
    // never among the defaults — is what makes assign-scope load-bearing:
    // without it, `app-roles` never reaches `assigned`, resolveScope drops
    // it from the granted set even though it was requested, and the role
    // mapped only to it becomes unreachable.
    await seed(['scope', '--tenant', tenantName, '--name', 'app-roles']);
    await seed(['role', '--tenant', tenantName, '--name', 'admin']);
    await seed(['grant-role', '--tenant', tenantName, '--username', 'ada', '--role', 'admin']);
    await seed(['map-role', '--tenant', tenantName, '--scope', 'app-roles', '--role', 'admin']);
    await seed([
      'assign-scope',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--scope',
      'app-roles',
      '--assignment',
      'optional',
    ]);

    // `roles` still has to be requested too: the roles claim mapper only
    // ever runs when the granted scope set contains the literal name
    // `roles` (packages/kernel/src/registries/claim-mapper.ts), independent
    // of which scope actually made a given role reachable.
    const { access_token } = await completeCodeFlow({
      clientId: 'app',
      scope: 'openid roles app-roles',
      tenantName,
    });
    expect(decode(access_token).roles).toEqual(['admin']);
  });

  // The API refuses these at `PATCH /clients/{id}`; without the same check
  // here the CHECK in 0015 is the only thing standing behind this door, and
  // it answers with a driver stack trace rather than a reason.
  it('refuses a web origin the database constraint would, naming it', async () => {
    const tenantName = `demo-${newId()}`;
    await seed(['tenant', '--name', tenantName]);

    await expect(
      seed([
        'client',
        '--tenant',
        tenantName,
        '--client-id',
        'app',
        '--public',
        '--redirect-uri',
        REDIRECT_URI,
        '--web-origin',
        'https://app.example/callback',
      ]),
    ).rejects.toThrow(
      /--web-origin names https:\/\/app\.example\/callback, which is not an origin/u,
    );
  });

  it('qualifies a client role with its owning client', async () => {
    const tenantName = `demo-${newId()}`;

    await seed(['tenant', '--name', tenantName]);
    await seed([
      'client',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--public',
      '--redirect-uri',
      REDIRECT_URI,
    ]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
      '--email',
      'ada@example.test',
    ]);
    // reports-api is a resource server of its own: a role qualified by it
    // can only exist once the client it qualifies does (roles_client_fk,
    // packages/db/drizzle/0017_roles.sql), the same way a tenant role never
    // needed a client seeded first.
    await seed([
      'client',
      '--tenant',
      tenantName,
      '--client-id',
      'reports-api',
      '--client-secret',
      's3cret',
      '--redirect-uri',
      'https://reports-api.example/cb',
    ]);
    await seed(['role', '--tenant', tenantName, '--name', 'reader', '--client-id', 'reports-api']);
    await seed([
      'grant-role',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--role',
      'reports-api:reader',
    ]);
    // A tenant-default scope like `roles` is already assigned to `app` the
    // moment `seed client` creates it, so mapping to one would never
    // exercise assign-scope — a scope of the tenant's own does.
    await seed(['scope', '--tenant', tenantName, '--name', 'app-roles']);
    await seed([
      'map-role',
      '--tenant',
      tenantName,
      '--scope',
      'app-roles',
      '--role',
      'reports-api:reader',
    ]);
    await seed([
      'assign-scope',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--scope',
      'app-roles',
      '--assignment',
      'optional',
    ]);

    const { access_token } = await completeCodeFlow({
      clientId: 'app',
      scope: 'openid roles app-roles',
      tenantName,
    });
    expect(decode(access_token).roles).toEqual(['reports-api:reader']);
  });

  it('refuses to grant a role that does not exist rather than creating one', async () => {
    const tenantName = `demo-${newId()}`;
    await seed(['tenant', '--name', tenantName]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
    ]);

    await expect(
      seed(['grant-role', '--tenant', tenantName, '--username', 'ada', '--role', 'nope']),
    ).rejects.toThrow(/no role named/);
  });

  it('refuses an ambiguous qualified role name rather than guessing a split', async () => {
    const tenantName = `demo-${newId()}`;
    await seed(['tenant', '--name', tenantName]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
    ]);

    await expect(
      seed(['grant-role', '--tenant', tenantName, '--username', 'ada', '--role', 'a:b:c']),
    ).rejects.toThrow(/more than one ':'/);
  });

  it('carries a joined group’s path in a token, nested under its parent', async () => {
    const tenantName = `demo-${newId()}`;

    await seed(['tenant', '--name', tenantName]);
    await seed([
      'client',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--public',
      '--redirect-uri',
      REDIRECT_URI,
    ]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
    ]);
    await seed(['group', '--tenant', tenantName, '--name', 'engineering']);
    await seed(['group', '--tenant', tenantName, '--name', 'backend', '--parent', '/engineering']);
    await seed([
      'join-group',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--group',
      '/engineering/backend',
    ]);

    const { access_token } = await completeCodeFlow({
      clientId: 'app',
      scope: 'openid groups',
      tenantName,
    });
    expect(decode(access_token).groups).toEqual(['/engineering/backend']);
  });

  // groupRepository.mapRole is tested at repository level, ancestor
  // inheritance included, but nothing before this closed the gap between
  // that and a shipped CLI: `map-role` maps a role to a client scope,
  // `grant-role` assigns one straight to a subject, and neither can create
  // a group_roles row. This is the only path that can, and the only test
  // that carries a role mapped to a *parent* group all the way to a token
  // for a user joined only to its *child* — the inheritance a headline
  // deliverable of this phase depends on.
  it('carries a role mapped to a parent group into a token for a user joined to its child', async () => {
    const tenantName = `demo-${newId()}`;

    await seed(['tenant', '--name', tenantName]);
    await seed([
      'client',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--public',
      '--redirect-uri',
      REDIRECT_URI,
    ]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
    ]);
    await seed(['group', '--tenant', tenantName, '--name', 'engineering']);
    await seed(['group', '--tenant', tenantName, '--name', 'backend', '--parent', '/engineering']);
    await seed([
      'join-group',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--group',
      '/engineering/backend',
    ]);

    // A scope of the tenant's own, not a default: mapping straight to
    // `roles` would leave assign-scope doing nothing a removed step would
    // reveal, the same reasoning the direct-assignment test above uses.
    await seed(['scope', '--tenant', tenantName, '--name', 'app-roles']);
    await seed(['role', '--tenant', tenantName, '--name', 'engineering-lead']);
    await seed([
      'map-group-role',
      '--tenant',
      tenantName,
      '--group',
      '/engineering',
      '--role',
      'engineering-lead',
    ]);
    await seed([
      'map-role',
      '--tenant',
      tenantName,
      '--scope',
      'app-roles',
      '--role',
      'engineering-lead',
    ]);
    await seed([
      'assign-scope',
      '--tenant',
      tenantName,
      '--client-id',
      'app',
      '--scope',
      'app-roles',
      '--assignment',
      'optional',
    ]);

    const { access_token } = await completeCodeFlow({
      clientId: 'app',
      scope: 'openid roles app-roles',
      tenantName,
    });
    expect(decode(access_token).roles).toEqual(['engineering-lead']);
  });

  it('refuses to map a role to a group that does not exist rather than creating one', async () => {
    const tenantName = `demo-${newId()}`;
    await seed(['tenant', '--name', tenantName]);
    await seed(['role', '--tenant', tenantName, '--name', 'admin']);

    await expect(
      seed([
        'map-group-role',
        '--tenant',
        tenantName,
        '--group',
        '/no-such-group',
        '--role',
        'admin',
      ]),
    ).rejects.toThrow(/no group at path/);
  });

  it('creates a client scope with the flags given, through the seed CLI', async () => {
    const tenantName = `demo-${newId()}`;
    await seed(['tenant', '--name', tenantName]);

    await seed([
      'scope',
      '--tenant',
      tenantName,
      '--name',
      'reports:read',
      '--include-in-id-token',
      'false',
    ]);

    const rows = await owner.db
      .select()
      .from(clientScopes)
      .where(eq(clientScopes.name, 'reports:read'));
    const [row] = rows;
    expect(row?.includeInIdToken).toBe(false);
  });

  it('updates a claim column through seed profile', async () => {
    const tenantName = `demo-${newId()}`;
    const tenant = await seed(['tenant', '--name', tenantName]);
    await seed([
      'user',
      '--tenant',
      tenantName,
      '--username',
      'ada',
      '--password',
      'correct horse battery',
    ]);

    await seed(['profile', '--tenant', tenantName, '--username', 'ada', '--name', 'Ada Lovelace']);

    const rows = await owner.db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.username, 'ada'), eq(users.tenantId, tenant.tenantId)));
    expect(rows[0]?.name).toBe('Ada Lovelace');
  });
});
