import { PassThrough } from 'node:stream';
import { chmod, mkdtemp, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type DatabaseHandle } from '@odudu/db';
import { ADMIN_CLIENT_ID, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { loadConfig } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#/app';
import { init, initCommand, type InitInput, type InitIo } from '#/cli/init';
import { DEFAULT_ADMIN_EMAIL } from '#/cli/init-plan';
import { promptAdmin } from '#/cli/prompt';
import { createLogger } from '#/logger';

const ENV_KEYS = [
  'ODUDU_DATABASE_URL',
  'ODUDU_APP_DATABASE_URL',
  'ODUDU_KEK',
  'ODUDU_CONSOLE',
  'ODUDU_CONSOLE_CLIENT_KEY',
  'ODUDU_PUBLIC_BASE_URL',
  'ODUDU_ADMIN_PASSWORD',
];
const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const EMAIL = 'ada@example.com';
const BASE = 'http://localhost:3000';

let database: TestDatabase;
let stateDir: string;
let saved: Record<string, string | undefined>;

// One cluster per test: roles are cluster-wide, and "empty database" has to
// mean no odudu_svc either.
beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  database = await startTestDatabase();
  stateDir = await mkdtemp(join(tmpdir(), 'odudu-init-'));
}, 120_000);

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    Reflect.deleteProperty(process.env, key);
    if (value !== undefined) process.env[key] = value;
  }
  await database.stop();
  await rm(stateDir, { recursive: true, force: true });
});

function inputWith(extra: Partial<InitInput> = {}): InitInput {
  return {
    adminEmail: EMAIL,
    interactive: false,
    publicBaseUrl: BASE,
    stateDir,
    ...extra,
  };
}

function capture(): { io: InitIo; out: string[] } {
  const out: string[] = [];
  return {
    out,
    io: {
      databaseUrl: database.adminUrl,
      out: (line) => {
        out.push(line);
      },
    },
  };
}

async function fileMode(): Promise<number> {
  return (await stat(join(stateDir, 'quickstart.env'))).mode;
}

async function envFile(): Promise<Map<string, string>> {
  const text = await readFile(join(stateDir, 'quickstart.env'), 'utf8');
  return new Map(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line): [string, string] => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

function formPost(
  app: FastifyInstance,
  url: string,
  fields: Record<string, string>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

// What the first sign-in shows: the page asking for a new password, or the
// redirect that carries a code.
type SignIn = 'change-password' | 'signed-in' | 'rejected';

async function signIn(email: string, password: string): Promise<SignIn> {
  const env = await envFile();
  const owner = createDatabase(database.adminUrl);
  const runtime = createDatabase(env.get('ODUDU_APP_DATABASE_URL') ?? '');
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const app = buildApp({
    tls: false,
    database: runtime,
    ownerDatabase: owner,
    kek: Buffer.from(env.get('ODUDU_KEK') ?? '', 'base64'),
    logger: createLogger(config),
  });
  try {
    await app.ready();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: ADMIN_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid',
      state: 'xyz',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
    });
    const form = await app.inject({
      url: `/tenants/${SYSTEM_TENANT_NAME}/protocol/openid-connect/auth?${query.toString()}`,
    });
    const session = /name="auth_session_id" value="([^"]*)"/u.exec(form.body)?.[1] ?? '';
    const login = await formPost(app, `/tenants/${SYSTEM_TENANT_NAME}/login-actions/authenticate`, {
      auth_session_id: session,
      username: email,
      password,
    });
    if (login.statusCode === 302) return 'signed-in';
    return login.body.includes('Change your password') ? 'change-password' : 'rejected';
  } finally {
    await app.close();
    await runtime.close();
    await owner.close();
  }
}

async function countRows(url: string, table: string): Promise<number> {
  const handle: DatabaseHandle = createDatabase(url);
  try {
    const rows = await handle.db.execute(sql.raw(`select count(*)::int as n from ${table}`));
    return (rows as unknown as { n: number }[])[0]?.n ?? -1;
  } finally {
    await handle.close();
  }
}

async function consoleClientSkipsLogoutConfirmation(): Promise<boolean> {
  const handle: DatabaseHandle = createDatabase(database.adminUrl);
  try {
    const rows = await handle.db.execute(
      sql`select skip_logout_confirmation as skip from clients where client_id = ${ADMIN_CLIENT_ID}`,
    );
    return (rows as unknown as { skip: boolean }[])[0]?.skip ?? false;
  } finally {
    await handle.close();
  }
}

describe('odudu init', () => {
  it('creates the roles, migrates, creates the system tenant and one administrator from an empty database', async () => {
    const { io, out } = capture();

    const report = await init(inputWith(), io);

    expect(report.created).toBe(true);
    expect(report.adminEmail).toBe(EMAIL);
    expect(report.consoleUrl).toBe(`${BASE}/console/`);
    expect(await countRows(database.adminUrl, 'tenants')).toBe(1);
    expect(await consoleClientSkipsLogoutConfirmation()).toBe(true);
    const env = await envFile();
    expect(await countRows(env.get('ODUDU_APP_DATABASE_URL') ?? '', 'tenants')).toBe(0);
    expect(await signIn(EMAIL, report.generatedPassword ?? '')).toBe('change-password');
    expect(await signIn(EMAIL, 'not-the-password')).toBe('rejected');
    expect((await fileMode()) & 0o777).toBe(0o600);
    expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    expect(out.join('\n')).toContain(report.generatedPassword ?? 'no password');
  }, 120_000);

  it('is idempotent: a second run changes nothing and reports created: false', async () => {
    await init(inputWith(), capture().io);
    const before = await countRows(database.adminUrl, 'subjects');
    const { io, out } = capture();

    const second = await init(inputWith(), io);

    expect(second.created).toBe(false);
    expect(second.generatedPassword).toBeUndefined();
    expect(await countRows(database.adminUrl, 'subjects')).toBe(before);
    expect(await countRows(database.adminUrl, 'tenants')).toBe(1);
    expect(out.join('\n')).not.toMatch(/password/iu);
    expect(out.join('\n')).toContain('odudu seed admin');
  }, 120_000);

  it('leaves an existing administrator alone whatever password the second run is given', async () => {
    const chosen = 'Chosen-Passw0rd!42';
    await init(inputWith({ adminPassword: chosen }), capture().io);

    const second = await init(inputWith({ adminPassword: 'Another-Passw0rd!77' }), capture().io);

    expect(second.created).toBe(false);
    expect(await signIn(EMAIL, chosen)).toBe('signed-in');
    expect(await signIn(EMAIL, 'Another-Passw0rd!77')).toBe('rejected');
  }, 120_000);

  it('refuses a different address once an administrator exists, unless adding one is explicit', async () => {
    await init(inputWith(), capture().io);

    await expect(
      init(inputWith({ adminEmail: 'grace@example.com' }), capture().io),
    ).rejects.toThrow(/--add-admin/u);
    const added = await init(
      inputWith({ adminEmail: 'grace@example.com', additionalAdmin: true }),
      capture().io,
    );

    expect(added.created).toBe(true);
    expect(await countRows(database.adminUrl, 'users')).toBe(2);
  }, 120_000);

  it('refuses a secrets file written for a different database', async () => {
    await init(inputWith(), capture().io);
    const { io } = capture();
    const admin = createDatabase(database.adminUrl, { max: 1 });
    await admin.sql.unsafe('create database elsewhere');
    await admin.close();

    await expect(
      init(inputWith(), { ...io, databaseUrl: io.databaseUrl.replace(/\/[^/]*$/u, '/elsewhere') }),
    ).rejects.toThrow(/quickstart\.env/u);
  }, 120_000);

  it('keeps the file, the roles and the administrator single when two runs race', async () => {
    const results = await Promise.all([
      init(inputWith(), capture().io),
      init(inputWith(), capture().io),
    ]);

    expect(results.filter((report) => report.created)).toHaveLength(1);
    expect(await countRows(database.adminUrl, 'users')).toBe(1);
    expect(await countRows(database.adminUrl, "pg_roles where rolname like 'odudu\\_%'")).toBe(2);
    expect((await envFile()).size).toBe(6);
    expect((await readdir(stateDir)).sort()).toEqual(['quickstart.env']);
  }, 120_000);

  it('stores the chosen password so the first sign-in is not forced to change it, and a generated one is', async () => {
    const chosen = 'Chosen-Passw0rd!42';

    const report = await init(inputWith({ adminPassword: chosen }), capture().io);

    expect(report.generatedPassword).toBeUndefined();
    expect(await signIn(EMAIL, chosen)).toBe('signed-in');
  }, 120_000);

  it('writes quickstart.env with mode 0600 and the same KEK on a second run', async () => {
    await init(inputWith(), capture().io);
    const first = await envFile();
    expect((await stat(join(stateDir, 'quickstart.env'))).mode & 0o777).toBe(0o600);

    await init(inputWith(), capture().io);

    const second = await envFile();
    expect(second.get('ODUDU_KEK')).toBe(first.get('ODUDU_KEK'));
    expect(second.get('ODUDU_APP_DATABASE_URL')).toBe(first.get('ODUDU_APP_DATABASE_URL'));
    expect(Buffer.from(first.get('ODUDU_KEK') ?? '', 'base64')).toHaveLength(32);
    expect(first.get('ODUDU_CONSOLE')).toBe('true');
    expect(first.get('ODUDU_PUBLIC_BASE_URL')).toBe(BASE);
    expect(first.get('ODUDU_CONSOLE_CLIENT_KEY')).toBeTruthy();
  }, 120_000);

  it('asks for the password on a terminal, checks it, and never prints it', async () => {
    const { io, out } = capture();
    const asked: (string | undefined)[] = [];

    const report = await init(inputWith({ interactive: true }), {
      ...io,
      promptAdmin: (validate, presetEmail) => {
        asked.push(presetEmail);
        expect(validate('short')).toMatch(/at least 15/u);
        return Promise.resolve({ email: presetEmail ?? '', password: 'Typed-Passw0rd!77' });
      },
    });

    expect(asked).toEqual([EMAIL]);
    expect(report.generatedPassword).toBeUndefined();
    expect(await signIn(EMAIL, 'Typed-Passw0rd!77')).toBe('signed-in');
    expect(out.join('\n')).not.toContain('Typed-Passw0rd!77');
    expect(out.join('\n')).toContain(EMAIL);
  }, 120_000);

  it('asks for the email too when none was given', async () => {
    const { io } = capture();

    const report = await init(
      { interactive: true, publicBaseUrl: BASE, stateDir },
      {
        ...io,
        promptAdmin: () =>
          Promise.resolve({ email: 'grace@example.com', password: 'Typed-Passw0rd!77' }),
      },
    );

    expect(report.adminEmail).toBe('grace@example.com');
    expect(await signIn('grace@example.com', 'Typed-Passw0rd!77')).toBe('signed-in');
  }, 120_000);

  it('does not prompt when the administrator already exists', async () => {
    await init(inputWith(), capture().io);
    const { io } = capture();
    let prompted = false;

    await init(inputWith({ interactive: true }), {
      ...io,
      promptAdmin: () => {
        prompted = true;
        return Promise.reject(new Error('should not ask'));
      },
    });

    expect(prompted).toBe(false);
  }, 120_000);

  it('uses the default administrator address when nobody names one and nobody can be asked', async () => {
    const { io, out } = capture();

    const report = await init({ interactive: false, publicBaseUrl: BASE, stateDir }, io);

    expect(report.adminEmail).toBe(DEFAULT_ADMIN_EMAIL);
    expect(out.join('\n')).toContain(DEFAULT_ADMIN_EMAIL);
    expect(await signIn(DEFAULT_ADMIN_EMAIL, report.generatedPassword ?? '')).toBe(
      'change-password',
    );
  }, 120_000);

  it('succeeds on a bare re-run after the email was prompted, changing and printing nothing more', async () => {
    const prompted = capture();
    await init(
      { interactive: true, publicBaseUrl: BASE, stateDir },
      {
        ...prompted.io,
        promptAdmin: () =>
          Promise.resolve({ email: 'grace@example.com', password: 'Typed-Passw0rd!77' }),
      },
    );
    const before = await countRows(database.adminUrl, 'users');
    const again = capture();

    const report = await init({ interactive: false, publicBaseUrl: BASE, stateDir }, again.io);

    expect(report.created).toBe(false);
    expect(again.out).toHaveLength(1);
    expect(again.out[0]).toContain('already exists');
    expect(again.out[0]).not.toContain(DEFAULT_ADMIN_EMAIL);
    expect(await countRows(database.adminUrl, 'users')).toBe(before);
    expect(await signIn('grace@example.com', 'Typed-Passw0rd!77')).toBe('signed-in');
  }, 120_000);

  it('does not ask a terminal for anything once an administrator exists', async () => {
    await init(inputWith(), capture().io);
    const { io, out } = capture();

    const report = await init(
      { interactive: true, publicBaseUrl: BASE, stateDir },
      {
        ...io,
        promptAdmin: () => Promise.reject(new Error('should not ask')),
      },
    );

    expect(report.created).toBe(false);
    expect(out.join('\n')).toContain('already exists');
  }, 120_000);

  it('defaults the address, and asks nothing, when a terminal has an environment password but no email', async () => {
    const { io, out } = capture();

    const report = await init(
      { interactive: true, adminPassword: 'Env-Passw0rd!55', publicBaseUrl: BASE, stateDir },
      { ...io, promptAdmin: () => Promise.reject(new Error('should not ask')) },
    );

    expect(report.adminEmail).toBe(DEFAULT_ADMIN_EMAIL);
    expect(await signIn(DEFAULT_ADMIN_EMAIL, 'Env-Passw0rd!55')).toBe('signed-in');
    expect(out.join('\n')).not.toContain('Env-Passw0rd!55');
  }, 120_000);

  it('hands the prompt the real email validator, so a bad address is re-asked before any password', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
    const output = new PassThrough();
    const shown: string[] = [];
    output.on('data', (chunk: Buffer) => shown.push(chunk.toString('utf8')));
    input.write('nobody\ngrace@example.com\nTyped-Passw0rd!77\nTyped-Passw0rd!77\n');
    const { io } = capture();

    const report = await init(
      { interactive: true, publicBaseUrl: BASE, stateDir },
      {
        ...io,
        promptAdmin: (validate, preset, validateEmail) =>
          promptAdmin({ input, output }, validate, preset, validateEmail),
      },
    );

    const text = shown.join('');
    expect(report.adminEmail).toBe('grace@example.com');
    expect(text).toContain('not an email address');
    expect(text.indexOf('not an email address')).toBeLessThan(text.indexOf('Password:'));
  }, 120_000);

  it('still refuses a different address that was asked for by name', async () => {
    await init({ interactive: false, publicBaseUrl: BASE, stateDir }, capture().io);

    await expect(
      init(inputWith({ adminEmail: 'grace@example.com' }), capture().io),
    ).rejects.toThrow(/--add-admin/u);
  }, 120_000);

  it('says a password from the environment stays in the container, without printing it', async () => {
    const { io, out } = capture();

    const report = await init(inputWith({ adminPassword: 'Env-Passw0rd!55' }), io);

    expect(report.passwordFromEnv).toBe(true);
    expect(out.join('\n')).toContain('docker compose rm -f setup');
    expect(out.join('\n')).not.toContain('Env-Passw0rd!55');
  }, 120_000);

  it('refuses to run against a non-loopback public base URL', async () => {
    await expect(
      init(inputWith({ publicBaseUrl: 'https://id.example.com' }), capture().io),
    ).rejects.toThrow(/ODUDU_PUBLIC_BASE_URL/u);
    await expect(stat(join(stateDir, 'quickstart.env'))).rejects.toThrow();
  }, 120_000);

  it('never prints a chosen password', async () => {
    const odd = `p'"$(id)\\n and ${'x7!Q'.repeat(50)}`;
    const { io, out } = capture();

    await init(inputWith({ adminPassword: odd }), io);

    const printed = out.join('\n');
    expect(printed).not.toContain(odd);
    for (let start = 0; start + 6 <= odd.length; start += 6) {
      expect(printed).not.toContain(odd.slice(start, start + 6));
    }
  }, 120_000);

  it('refuses a chosen password the system tenant policy rejects, naming the rule', async () => {
    const error = await init(inputWith({ adminPassword: 'Qz9!k' }), capture().io).catch(
      (caught: unknown) => caught,
    );

    expect(String(error)).toMatch(/at least/u);
    expect(String(error)).not.toContain('Qz9!k');
  }, 120_000);

  it('refuses roles that exist while the secrets file is gone, rather than resetting their password', async () => {
    await init(inputWith(), capture().io);
    await unlink(join(stateDir, 'quickstart.env'));

    await expect(init(inputWith(), capture().io)).rejects.toMatchObject({
      code: 'init_roles_without_secrets',
    });
  }, 120_000);

  it('refuses a state directory others can write to, and accepts one they can only read', async () => {
    await chmod(stateDir, 0o777);
    await expect(init(inputWith(), capture().io)).rejects.toThrow(/writable/u);
    await expect(stat(join(stateDir, 'quickstart.env'))).rejects.toThrow();

    await chmod(stateDir, 0o755);
    await expect(init(inputWith(), capture().io)).resolves.toMatchObject({ created: true });
  }, 120_000);

  it('refuses a state directory others can write to even when the secrets file exists', async () => {
    await init(inputWith(), capture().io);
    await chmod(stateDir, 0o777);

    await expect(init(inputWith(), capture().io)).rejects.toThrow(/writable/u);
  }, 120_000);

  it('creates no state directory when it refuses for existing roles', async () => {
    await init(inputWith(), capture().io);
    const fresh = join(stateDir, 'fresh');

    await expect(init(inputWith({ stateDir: fresh }), capture().io)).rejects.toMatchObject({
      code: 'init_roles_without_secrets',
    });
    await expect(stat(fresh)).rejects.toThrow();
  }, 120_000);

  it('gives up waiting for another init after the lock wait, naming it', async () => {
    const holder = createDatabase(database.adminUrl, { max: 1 });
    await holder.sql`select pg_advisory_lock(hashtext('odudu_init'), 0)`;
    try {
      const { io } = capture();
      await expect(init(inputWith(), { ...io, lockWaitMs: 400 })).rejects.toThrow(
        /another odudu init/u,
      );
      await expect(stat(join(stateDir, 'quickstart.env'))).rejects.toThrow();
    } finally {
      await holder.close();
    }
  }, 120_000);

  it.skipIf(process.getuid?.() === 0)(
    'leaves nothing behind when the secrets cannot be written',
    async () => {
      await chmod(stateDir, 0o500);

      await expect(init(inputWith(), capture().io)).rejects.toThrow(/EACCES|permission/iu);

      await chmod(stateDir, 0o700);
      expect(await readdir(stateDir)).toEqual([]);
    },
    120_000,
  );
});

describe('odudu init as a command', () => {
  it('reads --add-admin and treats an empty ODUDU_ADMIN_PASSWORD as unset', async () => {
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      printed.push(String(line));
    });
    process.env.ODUDU_DATABASE_URL = database.adminUrl;
    process.env.ODUDU_ADMIN_PASSWORD = '';
    try {
      await initCommand(['--state-dir', stateDir, '--admin-email', EMAIL], null);
      const generated = /^ password: (\S+)$/mu.exec(printed.join('\n'))?.[1] ?? '';
      expect(await signIn(EMAIL, generated)).toBe('change-password');

      await expect(
        initCommand(['--state-dir', stateDir, '--admin-email', 'grace@example.com'], null),
      ).rejects.toThrow(/--add-admin/u);
      process.env.ODUDU_ADMIN_PASSWORD = 'Chosen-Passw0rd!42';
      await initCommand(
        ['--state-dir', stateDir, '--admin-email', 'grace@example.com', '--add-admin'],
        null,
      );
      expect(await signIn('grace@example.com', 'Chosen-Passw0rd!42')).toBe('signed-in');
    } finally {
      log.mockRestore();
    }
  }, 120_000);

  it('takes the administrator from ODUDU_ADMIN_EMAIL when no option names one', async () => {
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      printed.push(String(line));
    });
    process.env.ODUDU_DATABASE_URL = database.adminUrl;
    delete process.env.ODUDU_ADMIN_PASSWORD;
    process.env.ODUDU_ADMIN_EMAIL = 'env-admin@example.com';
    try {
      await initCommand(['--state-dir', stateDir], null);

      expect(printed.join('\n')).toContain('env-admin@example.com');
    } finally {
      delete process.env.ODUDU_ADMIN_EMAIL;
      log.mockRestore();
    }
  }, 120_000);
});
