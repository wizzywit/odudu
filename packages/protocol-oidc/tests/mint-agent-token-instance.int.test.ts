import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { provisionTenant, SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_API_AUDIENCE,
  clientRepository,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withHeldLock } from '#/testing/agent-fixture';
import { standardClaimMappers } from '#/service/claims';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import {
  AgentTokenRefused,
  mintAgentToken,
  type MintAgentTokenDeps,
  type MintAgentTokenInput,
} from '#/usecase/mint-agent-token';

const KEK = Buffer.alloc(32, 37);
const AGENT = 'agent-client';
const MCP_AUDIENCE = 'https://odudu.test/tenants/acme/mcp';
const LIFESPANS = {
  ssoSessionIdleSeconds: 30 * 24 * 3600,
  ssoSessionMaxSeconds: 30 * 24 * 3600,
  rememberMeIdleSeconds: 30 * 24 * 3600,
  rememberMeMaxSeconds: 30 * 24 * 3600,
};

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

interface World {
  tenantId: string;
  issuer: string;
  agent: ClientRecord;
  subjectId: string;
  sessionId: string;
  grantId: string;
  deps: MintAgentTokenDeps;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

async function newClient(tx: TenantScopedDatabase, tenantId: string, clientId: string) {
  const client = await clientRepository(tx).create({
    tenantId,
    clientId,
    name: clientId,
    type: 'public',
    secretHash: null,
  });
  await provisionClientDefaults(tx, client.id);
  return client;
}

async function grantFor(
  tx: TenantScopedDatabase,
  w: Pick<World, 'tenantId' | 'subjectId' | 'sessionId'>,
  clientDbId: string,
  scope: string,
  sessionless = false,
): Promise<string> {
  const id = newId();
  await tokenGrantRepository(tx).create({
    id,
    tenantId: w.tenantId,
    clientId: clientDbId,
    subjectId: w.subjectId,
    scope,
    audience: [MCP_AUDIENCE],
    sessionId: sessionless ? null : w.sessionId,
  });
  return id;
}

async function newWorld(
  options: { agentType?: boolean; grantScope?: string; sessionless?: boolean } = {},
): Promise<World> {
  const grantScope = options.grantScope ?? 'mcp:read mcp:write';
  const tenantId = newId();
  const name = `mint-${newId()}`;
  const issuer = `https://odudu.test/tenants/${name}`;
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    const generated = await generateSigningKey('ES256', KEK);
    await signingKeyRepository(tx).create({
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
    });
    const agent = await newClient(tx, tenantId, AGENT);
    await clientOidcConfigRepository(tx).create({
      clientId: agent.id,
      tenantId,
      redirectUris: ['https://agent.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3600,
      agentType: options.agentType ?? false,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const sessionId = newId();
    await sessionRepository(tx).create({
      id: sessionId,
      tenantId,
      subjectId: subject.id,
      expiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
      authenticators: ['pwd'],
      secretHash: SessionEntry.issue(sessionId).secretHash(),
    });
    const base = { tenantId, subjectId: subject.id, sessionId };
    const grantId = await grantFor(tx, base, agent.id, grantScope, options.sessionless ?? false);
    return {
      ...base,
      issuer,
      agent,
      grantId,
      deps: {
        tenantId,
        issuer,
        kek: KEK,
        claimMappers: standardClaimMappers(),
        lifespans: LIFESPANS,
      },
    };
  });
}

function input(w: World, over: Partial<MintAgentTokenInput> = {}): MintAgentTokenInput {
  return {
    subjectGrantId: w.grantId,
    expectedSubjectId: w.subjectId,
    agentClientId: AGENT,
    audience: ADMIN_API_AUDIENCE,
    scope: ['mcp:read'],
    notAfter: new Date(NOW.getTime() + 3600_000),
    now: NOW,
    ...over,
  };
}

function mint(w: World, over: Partial<MintAgentTokenInput> = {}) {
  return withTenant(app.db, w.tenantId, (tx) => mintAgentToken(tx, w.deps, input(w, over)));
}

// The caller that wants a refusal's own writes kept commits instead of
// letting the refusal roll its transaction back.
async function refusedWith(w: World, over: Partial<MintAgentTokenInput>): Promise<string> {
  const outcome = await withTenant(app.db, w.tenantId, async (tx) => {
    try {
      await mintAgentToken(tx, w.deps, input(w, over));
      return null;
    } catch (error) {
      if (error instanceof AgentTokenRefused) return error.reason;
      throw error;
    }
  });
  return outcome ?? 'not refused';
}

function claimsOf(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const actOf = (token: string): string => (claimsOf(token).act as { sub: string }).sub;

async function rows(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return owner.db.execute(query);
}

const instancesOf = (w: World) =>
  rows(sql`select * from agent_instances where tenant_id = ${w.tenantId} order by created_at`);

async function setSessionEnd(w: World, at: Date): Promise<void> {
  await owner.db.execute(
    sql`update sessions set expires_at = ${at.toISOString()}::timestamptz where id = ${w.sessionId}`,
  );
}

// Runs a mint that blocks on a row lock another transaction holds, applies
// `during` while it waits, then lets it continue: the way to change the world
// between two reads one mint makes.
async function refusedWhileLocked(
  w: World,
  over: Partial<MintAgentTokenInput>,
  lock: ReturnType<typeof sql>,
  during: () => Promise<void>,
): Promise<string> {
  let release = (): void => undefined;
  let locked = (): void => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const holder = owner.db.transaction(async (tx) => {
    await tx.execute(lock);
    locked();
    await held;
  });
  await isLocked;
  const attempt = refusedWith(w, over);
  for (;;) {
    const waiting = await rows(sql`select 1 from pg_locks where not granted`);
    if (waiting.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await during();
  release();
  await holder;
  return attempt;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('mintAgentToken without an instance', () => {
  it('names the client in act for a client that is not an agent type, run or not', async () => {
    const w = await newWorld({ agentType: false });
    const plain = claimsOf((await mint(w)).accessToken);
    const withRun = claimsOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const { jti: plainJti, ...plainRest } = plain;
    const { jti: runJti, ...runRest } = withRun;
    expect(plainJti).not.toBe(runJti);
    expect(runRest).toEqual(plainRest);
    expect(runRest.act).toEqual({ sub: AGENT });
    expect(await instancesOf(w)).toHaveLength(0);
  });

  it('names the client in act for an agent type given no run', async () => {
    const w = await newWorld({ agentType: true });
    const claims = claimsOf((await mint(w)).accessToken);
    expect(claims.act).toEqual({ sub: AGENT });
    expect(await instancesOf(w)).toHaveLength(0);
  });
});

describe('the OIDC configuration read', () => {
  // Scans of the configuration table made by this transaction while it mints,
  // read from the statistics a transaction keeps for itself.
  async function configScans(w: World, over: Partial<MintAgentTokenInput>): Promise<number> {
    return withTenant(app.db, w.tenantId, async (tx) => {
      const scans = async (): Promise<number> => {
        const found = (await tx.execute(
          sql`select coalesce(sum(seq_scan + idx_scan), 0)::int as n from pg_stat_xact_user_tables
               where relname = 'client_oidc_config'`,
        )) as unknown as { n: number }[];
        return found[0]?.n ?? 0;
      };
      const before = await scans();
      await mintAgentToken(tx, w.deps, input(w, over));
      return (await scans()) - before;
    });
  }

  it('is not made by a call with no run', async () => {
    const w = await newWorld({ agentType: true });
    expect(await configScans(w, {})).toBe(0);
  });

  it('is made by a call with a run', async () => {
    const w = await newWorld({ agentType: true });
    expect(await configScans(w, { run: { key: 'conv-1' } })).toBeGreaterThan(0);
  });
});

describe('mintAgentToken for a run of an agent type', () => {
  it('names a new instance in act.sub and keeps sub the owner', async () => {
    const w = await newWorld({ agentType: true });
    const { accessToken } = await mint(w, { run: { key: 'conv-1' } });
    const claims = claimsOf(accessToken);
    const id = actOf(accessToken);
    expect(id).toMatch(UUID);
    expect(claims).toMatchObject({
      sub: w.subjectId,
      client_id: AGENT,
      grant_id: w.grantId,
      scope: 'mcp:read',
      via: 'mcp',
    });
    const [row] = await instancesOf(w);
    expect(row).toMatchObject({
      id,
      owner_subject_id: w.subjectId,
      agent_client_id: w.agent.id,
      parent_instance_id: null,
      root_grant_id: w.grantId,
      depth: 1,
      scope: 'mcp:read mcp:write',
    });
  });

  it('writes agent.instance_minted once and makes no grant', async () => {
    const w = await newWorld({ agentType: true });
    const grants = await rows(sql`select id from token_grants where tenant_id = ${w.tenantId}`);
    const { accessToken } = await mint(w, { run: { key: 'conv-1' } });
    await mint(w, { run: { key: 'conv-1' } });
    const id = actOf(accessToken);
    const audit = await rows(
      sql`select event_type, resource_id from audit_events
           where tenant_id = ${w.tenantId} and action = 'agent.instance_minted'`,
    );
    expect(audit).toEqual([{ event_type: 'agent_identity', resource_id: id }]);
    expect(
      await rows(sql`select id from token_grants where tenant_id = ${w.tenantId}`),
    ).toHaveLength(grants.length);
  });

  it('reuses the instance for the same key and makes another for a different key', async () => {
    const w = await newWorld({ agentType: true });
    const first = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const again = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const other = actOf((await mint(w, { run: { key: 'conv-2' } })).accessToken);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(await instancesOf(w)).toHaveLength(2);
  });

  it('does not share an instance between two grants with the same key', async () => {
    const a = await newWorld({ agentType: true });
    const b = await newWorld({ agentType: true });
    const first = actOf((await mint(a, { run: { key: 'conv-1' } })).accessToken);
    const second = actOf((await mint(b, { run: { key: 'conv-1' } })).accessToken);
    expect(second).not.toBe(first);
  });

  it('mints exactly one instance for two concurrent calls with one key', async () => {
    const w = await newWorld({ agentType: true });
    const [x, y] = await Promise.all([
      mint(w, { run: { key: 'conv-1' } }),
      mint(w, { run: { key: 'conv-1' } }),
    ]);
    expect(actOf(x.accessToken)).toBe(actOf(y.accessToken));
    expect(await instancesOf(w)).toHaveLength(1);
  });

  it('gives a nested run a child of the parent instance', async () => {
    const w = await newWorld({ agentType: true });
    const parent = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const child = actOf(
      (await mint(w, { run: { key: 'sub-1', parentInstanceId: parent } })).accessToken,
    );
    const row = (await instancesOf(w)).find((entry) => entry.id === child);
    expect(row).toMatchObject({ parent_instance_id: parent, depth: 2 });
  });

  it('refuses a nested run under a parent that is not a live instance of the owner', async () => {
    const w = await newWorld({ agentType: true });
    const parent = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await owner.db.execute(sql`update agent_instances set revoked_at = now() where id = ${parent}`);
    expect(await refusedWith(w, { run: { key: 'sub-1', parentInstanceId: parent } })).toBe(
      'run_refused',
    );
    expect(await instancesOf(w)).toHaveLength(1);
  });

  it('refuses once the instance of the key was revoked', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await owner.db.execute(sql`update agent_instances set revoked_at = now() where id = ${id}`);
    expect(await refusedWith(w, { run: { key: 'conv-1' } })).toBe('run_refused');
  });

  it('refuses once the instance of the key has lapsed', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await owner.db.execute(
      sql`update agent_instances set expires_at = ${new Date(NOW.getTime() - 1000).toISOString()}::timestamptz
           where id = ${id}`,
    );
    expect(await refusedWith(w, { run: { key: 'conv-1' } })).toBe('run_refused');
  });
});

describe('the idle lifetime of a run instance', () => {
  const idleOf = async (w: World): Promise<number> => {
    const [row] = await instancesOf(w);
    return new Date(String(row?.idle_expires_at)).getTime();
  };

  it('starts idle seconds after the first call and slides on each use', async () => {
    const w = await newWorld({ agentType: true });
    await mint(w, { run: { key: 'conv-1' } });
    expect(await idleOf(w)).toBe(NOW.getTime() + 1800_000);
    const later = new Date(NOW.getTime() + 600_000);
    await mint(w, {
      run: { key: 'conv-1' },
      now: later,
      notAfter: new Date(later.getTime() + 3600_000),
    });
    expect(await idleOf(w)).toBe(later.getTime() + 1800_000);
  });

  it('never slides past the end of the session', async () => {
    const w = await newWorld({ agentType: true });
    const end = new Date(NOW.getTime() + 1000_000);
    await setSessionEnd(w, end);
    await mint(w, { run: { key: 'conv-1' } });
    expect(await idleOf(w)).toBe(end.getTime());
    const later = new Date(NOW.getTime() + 500_000);
    await mint(w, {
      run: { key: 'conv-1' },
      now: later,
      notAfter: new Date(later.getTime() + 3600_000),
    });
    expect(await idleOf(w)).toBe(end.getTime());
    const [row] = await instancesOf(w);
    expect(new Date(String(row?.expires_at)).getTime()).toBe(end.getTime());
  });

  it('stays usable past 24 hours of activity inside a session of three days', async () => {
    const w = await newWorld({ agentType: true });
    const end = new Date(NOW.getTime() + 3 * 86_400_000);
    await setSessionEnd(w, end);
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const [first] = await instancesOf(w);
    expect(new Date(String(first?.expires_at)).getTime()).toBe(end.getTime());
    let at = NOW;
    for (let step = 0; step < 62; step += 1) {
      at = new Date(at.getTime() + 25 * 60_000);
      const minted = await mint(w, {
        run: { key: 'conv-1' },
        now: at,
        notAfter: new Date(at.getTime() + 3600_000),
      });
      expect(actOf(minted.accessToken)).toBe(id);
    }
    expect(at.getTime() - NOW.getTime()).toBeGreaterThan(86_400_000);
    expect(await idleOf(w)).toBe(at.getTime() + 1800_000);
  });

  it('refuses a call after the instance idled out', async () => {
    const w = await newWorld({ agentType: true });
    await mint(w, { run: { key: 'conv-1' } });
    const later = new Date(NOW.getTime() + 1801_000);
    expect(
      await refusedWith(w, {
        run: { key: 'conv-1' },
        now: later,
        notAfter: new Date(later.getTime() + 3600_000),
      }),
    ).toBe('run_refused');
  });

  it('does not treat a live fixed-lifetime instance as dead', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await owner.db.execute(sql`update agent_instances set idle_expires_at = null where id = ${id}`);
    const again = await mint(w, { run: { key: 'conv-1' } });
    expect(actOf(again.accessToken)).toBe(id);
    const [row] = await instancesOf(w);
    expect(row?.idle_expires_at).toBeNull();
    expect(row?.revoked_at).toBeNull();
  });
});

describe('a run on a grant with no session', () => {
  it('expires 24 hours after the mint and is refused after that', async () => {
    const w = await newWorld({ agentType: true, sessionless: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const [row] = await instancesOf(w);
    expect(new Date(String(row?.expires_at)).getTime()).toBe(NOW.getTime() + 86_400_000);
    await owner.db.execute(
      sql`update agent_instances set idle_expires_at = ${new Date(NOW.getTime() + 9e8).toISOString()}::timestamptz
           where id = ${id}`,
    );
    const late = new Date(NOW.getTime() + 86_401_000);
    expect(
      await refusedWith(w, {
        run: { key: 'conv-1' },
        now: late,
        notAfter: new Date(late.getTime() + 3600_000),
      }),
    ).toBe('run_refused');
  });
});

describe('a run whose owner has ended', () => {
  it('is refused owner_ended and its instance revoked once the session ended', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await setSessionEnd(w, new Date(NOW.getTime() + 10_000));
    const later = new Date(NOW.getTime() + 20_000);
    expect(
      await refusedWith(w, {
        run: { key: 'conv-1' },
        now: later,
        notAfter: new Date(later.getTime() + 3600_000),
      }),
    ).toBe('owner_ended');
    const [row] = await instancesOf(w);
    expect(row).toMatchObject({ id });
    expect(Number.isNaN(Date.parse(String(row?.revoked_at)))).toBe(false);
  });

  it('is refused owner_ended and its instance revoked once the owner is disabled', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await owner.db.execute(sql`update subjects set disabled_at = now() where id = ${w.subjectId}`);
    expect(await refusedWith(w, { run: { key: 'conv-1' } })).toBe('owner_ended');
    const [row] = await instancesOf(w);
    expect(row).toMatchObject({ id });
    expect(Number.isNaN(Date.parse(String(row?.revoked_at)))).toBe(false);
  });

  it('revokes the instances beneath the run too', async () => {
    const w = await newWorld({ agentType: true });
    const parent = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await mint(w, { run: { key: 'sub-1', parentInstanceId: parent } });
    await setSessionEnd(w, new Date(NOW.getTime() + 10_000));
    const later = new Date(NOW.getTime() + 20_000);
    await refusedWith(w, {
      run: { key: 'conv-1' },
      now: later,
      notAfter: new Date(later.getTime() + 3600_000),
    });
    const all = await instancesOf(w);
    expect(all).toHaveLength(2);
    expect(all.every((entry) => entry.revoked_at !== null)).toBe(true);
  });

  it('writes agent.instance_revoked for the run, counting what was beneath it', async () => {
    const w = await newWorld({ agentType: true });
    const parent = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    await mint(w, { run: { key: 'sub-1', parentInstanceId: parent } });
    await setSessionEnd(w, new Date(NOW.getTime() + 10_000));
    const later = new Date(NOW.getTime() + 20_000);
    const args = {
      run: { key: 'conv-1' },
      now: later,
      notAfter: new Date(later.getTime() + 3600_000),
    };
    await refusedWith(w, args);
    await refusedWith(w, args);
    const audit = await rows(
      sql`select event_type, resource_id, detail from audit_events
           where tenant_id = ${w.tenantId} and action = 'agent.instance_revoked'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      event_type: 'agent_identity',
      resource_id: parent,
      detail: {
        agent_client: AGENT,
        owner: w.subjectId,
        instance: parent,
        depth: 1,
        count: 2,
        via: 'owner_ended',
      },
    });
  });

  it('is refused owner_ended and its instance revoked when the session vanishes mid-mint', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const reason = await refusedWhileLocked(
      w,
      { run: { key: 'conv-1' } },
      sql`select id from token_grants where id = ${w.grantId} for update`,
      () => setSessionEnd(w, new Date(NOW.getTime() - 1000)),
    );
    expect(reason).toBe('owner_ended');
    const [row] = await instancesOf(w);
    expect(row).toMatchObject({ id });
    expect(Number.isNaN(Date.parse(String(row?.revoked_at)))).toBe(false);
  });

  it('is refused run_refused for a new run whose session vanishes while its parent is read', async () => {
    const w = await newWorld({ agentType: true });
    const parent = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const reason = await refusedWhileLocked(
      w,
      { run: { key: 'sub-1', parentInstanceId: parent } },
      sql`select id from agent_instances where id = ${parent} for update`,
      () => setSessionEnd(w, new Date(NOW.getTime() - 1000)),
    );
    expect(reason).toBe('run_refused');
    expect(await instancesOf(w)).toHaveLength(1);
  });

  it('leaves the refusals of a call with no run as they were', async () => {
    const w = await newWorld({ agentType: true });
    await setSessionEnd(w, new Date(NOW.getTime() + 10_000));
    const later = new Date(NOW.getTime() + 20_000);
    expect(
      await refusedWith(w, { now: later, notAfter: new Date(later.getTime() + 3600_000) }),
    ).toBe('session_ended');
  });

  it('writes no instance for a first call that finds the session already ended', async () => {
    const w = await newWorld({ agentType: true });
    await setSessionEnd(w, new Date(NOW.getTime() - 1000));
    expect(await refusedWith(w, { run: { key: 'conv-1' } })).toBe('owner_ended');
    expect(await instancesOf(w)).toHaveLength(0);
  });
});

describe('the expiry of a run token', () => {
  it('never outlives the instance it names', async () => {
    const w = await newWorld({ agentType: true });
    const id = actOf((await mint(w, { run: { key: 'conv-1' } })).accessToken);
    const near = new Date(NOW.getTime() + 60_000);
    await owner.db.execute(
      sql`update agent_instances set expires_at = ${near.toISOString()}::timestamptz where id = ${id}`,
    );
    const { accessToken, expiresAt } = await mint(w, { run: { key: 'conv-1' } });
    expect(expiresAt.getTime()).toBeLessThanOrEqual(near.getTime());
    expect(Number(claimsOf(accessToken).exp) * 1000).toBeLessThanOrEqual(near.getTime());
  });

  it('never outlives a new instance either', async () => {
    const w = await newWorld({ agentType: true });
    await setSessionEnd(w, new Date(NOW.getTime() + 60_000));
    const { expiresAt } = await mint(w, { run: { key: 'conv-1' } });
    const [row] = await instancesOf(w);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(new Date(String(row?.expires_at)).getTime());
  });
});

describe('a foreign tenant and the run instance', () => {
  it('cannot be reached with the id of an instance from another tenant', async () => {
    const a = await newWorld({ agentType: true });
    const b = await newWorld({ agentType: true });
    const id = actOf((await mint(a, { run: { key: 'conv-1' } })).accessToken);
    const seen = await withTenant(app.db, b.tenantId, (tx) => agentInstanceRepository(tx).byId(id));
    expect(seen).toBeNull();
  });
});

describe('a mint on an exchanged grant racing a logout', () => {
  // The mint finds the session ended only after it has the grant, and a refusal
  // revokes the run, which needs the lineage root a logout already holds. The
  // mint therefore takes the root before the grant.
  it('is refused owner_ended, and the logout finishes, without a deadlock', async () => {
    const w = await newWorld({ agentType: true });
    const exchanged = newId();
    await withTenant(app.db, w.tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: exchanged,
        tenantId: w.tenantId,
        clientId: w.agent.id,
        subjectId: w.subjectId,
        scope: 'mcp:read mcp:write',
        audience: [MCP_AUDIENCE],
        sessionId: w.sessionId,
        exchangedFromGrantId: w.grantId,
      }),
    );
    await mint(w, { subjectGrantId: exchanged, run: { key: 'conv-9' } });
    const settle = <T>(run: () => Promise<T>) =>
      run().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    const outcomes = await withHeldLock(
      app.db,
      w.tenantId,
      {
        lock: async (tx) => {
          await tx.execute(
            sql`select id from token_grants where id = ${exchanged} for no key update`,
          );
        },
      },
      async (held) => {
        const minting = held.started(
          settle(() =>
            withTenant(app.db, w.tenantId, async (tx) => {
              try {
                await mintAgentToken(
                  tx,
                  w.deps,
                  input(w, { subjectGrantId: exchanged, run: { key: 'conv-9' } }),
                );
                return null;
              } catch (error) {
                if (error instanceof AgentTokenRefused) return error.reason;
                throw error;
              }
            }),
          ),
        );
        await held.waitForWaiters(owner);
        await setSessionEnd(w, new Date(NOW.getTime() - 1_000));
        const logout = held.started(
          settle(() =>
            withTenant(app.db, w.tenantId, (tx) =>
              tokenGrantRepository(tx).revokeForSession(w.sessionId, NOW),
            ),
          ),
        );
        await held.waitForWaiters(owner, 2);
        held.release();
        return Promise.all([minting, logout, held.done]);
      },
    );
    expect(outcomes[0]).toEqual({ value: 'owner_ended' });
    expect(outcomes[1]).toEqual({ value: 2 });
  });
});
