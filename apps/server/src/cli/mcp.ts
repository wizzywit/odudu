import {
  loadClientKey,
  generateClientKey,
  signClientAssertion,
  type ClientKey,
} from '@odudu/crypto';
import { ADMIN_API_AUDIENCE, MCP_CLIENT_ID } from '@odudu/domain-tenant';
import {
  callMcpTool,
  createBrowserOpener,
  configDirectory,
  createCredentialStore,
  createFileLock,
  failureLine,
  createHttpCaller,
  createOauthClient,
  createTokenSource,
  fileModeProblem,
  listenOnLoopback,
  loopbackLogin,
  runTool,
  serveMcpStdio,
  StdioError,
  stdioTarget,
  toolServer,
  TOOLS,
  visibleTools,
  type CredentialStore,
  type Credential,
  type OauthClient,
  type RegisteredTool,
  type RunTool,
  type StdioTarget,
  type ToolResult,
} from '@odudu/mcp';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { MCP_OPTIONS } from '#/cli/mcp-options';

export interface McpIo {
  readonly stdin: Readable;
  // Protocol only: every line a person should read goes to `stderr`.
  readonly stdout: Writable;
  readonly stderr: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  // Where a sign-in is kept when the operating system has no store for it.
  readonly configDir: string;
  readonly run: RunTool;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly entropy: (bytes: number) => Uint8Array;
  readonly openBrowser?: (url: string) => Promise<boolean>;
}

export function processMcpIo(): McpIo {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    platform: process.platform,
    configDir: configDirectory(process.env, homedir(), process.platform),
    run: runTool,
    fetch,
    now: () => new Date(),
    entropy: (bytes) => randomBytes(bytes),
  };
}

// How long a tool call may wait: a first sign-in is the person's to finish.
function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

const TOOL_DEADLINE_MS = 360_000;
const SIGN_IN_TIMEOUT_MS = 300_000;
const MAX_BAD_REQUESTS = 20;

type Values = ReturnType<typeof parse>['values'];

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: MCP_OPTIONS, allowPositionals: true });
  } catch (error) {
    throw new StdioError(
      'mcp_invalid_options',
      error instanceof Error ? error.message : 'invalid options',
    );
  }
}

function checked(argv: readonly string[]): Values {
  const { values, positionals } = parse(argv);
  if (positionals.length > 0) {
    throw new StdioError(
      'mcp_invalid_options',
      `unexpected argument ${JSON.stringify(positionals[0])}`,
    );
  }
  if (values['read-only'] === true && values['allow-writes'] === true) {
    throw new StdioError(
      'mcp_invalid_options',
      '--read-only and --allow-writes contradict each other; give one',
    );
  }
  return values;
}

function required(values: Values): { baseUrl: string; tenant: string } {
  if (values['base-url'] === undefined) {
    throw new StdioError(
      'mcp_invalid_options',
      '--base-url is required (the address of the Odudu instance)',
    );
  }
  if (values.tenant === undefined) {
    throw new StdioError('mcp_invalid_options', '--tenant is required (the tenant to act in)');
  }
  return { baseUrl: values['base-url'], tenant: values.tenant };
}

async function keyText(values: Values, io: McpIo): Promise<string | undefined> {
  const fromEnv = io.env.ODUDU_MCP_KEY;
  const file = values['key-file'];
  if (fromEnv !== undefined && fromEnv !== '' && file !== undefined) {
    throw new StdioError(
      'mcp_invalid_options',
      'give the key once: ODUDU_MCP_KEY or --key-file, only one',
    );
  }
  if (file === undefined) return fromEnv === '' ? undefined : fromEnv;
  const info = await stat(file).catch(() => null);
  if (info === null)
    throw new StdioError('mcp_invalid_options', `--key-file ${file} cannot be read`);
  const problem = io.platform === 'win32' ? undefined : fileModeProblem(info.mode, 'file');
  if (problem !== undefined) {
    throw new StdioError(
      'mcp_store_insecure',
      `the key file ${file} ${problem}; fix it with chmod 600`,
    );
  }
  return (await readFile(file, 'utf8')).trim();
}

async function loadKey(text: string): Promise<ClientKey> {
  try {
    return await loadClientKey(text);
  } catch {
    throw new StdioError(
      'mcp_key_invalid',
      'the service account key is not a key made by odudu mcp --keygen',
    );
  }
}

interface ServiceAccount {
  readonly key: ClientKey;
  readonly clientId: string;
}

async function serviceAccount(values: Values, io: McpIo): Promise<ServiceAccount | undefined> {
  const text = await keyText(values, io);
  const clientId = values['client-id'] ?? io.env.ODUDU_MCP_CLIENT_ID;
  const hasId = clientId !== undefined && clientId !== '';
  if (text === undefined && !hasId) return undefined;
  if (text === undefined) {
    throw new StdioError(
      'mcp_missing_credential',
      'a client id needs its private key: set ODUDU_MCP_KEY or pass --key-file',
    );
  }
  if (!hasId) {
    throw new StdioError(
      'mcp_missing_credential',
      'a service account key needs the client it belongs to: pass --client-id or set ODUDU_MCP_CLIENT_ID',
    );
  }
  return { key: await loadKey(text), clientId };
}

function discovering(oauth: OauthClient): OauthClient['discover'] {
  let found: ReturnType<OauthClient['discover']> | undefined;
  return () => {
    // A failure is not kept: the next call, once its cooldown is over, asks again.
    found ??= oauth.discover().catch((error: unknown) => {
      found = undefined;
      throw error;
    });
    return found;
  };
}

function keyCredential(
  account: ServiceAccount,
  oauth: OauthClient,
  discover: OauthClient['discover'],
  scope: string,
  io: McpIo,
): Credential {
  return {
    kind: 'key',
    fetch: async () => {
      const server = await discover();
      const assertion = await signClientAssertion(account.key, {
        clientId: account.clientId,
        audience: server.tokenEndpoint,
        now: io.now(),
      });
      return oauth.clientCredentials(server, {
        clientId: account.clientId,
        assertion,
        scope,
        resource: ADMIN_API_AUDIENCE,
      });
    },
  };
}

function browserCredential(
  scope: 'mcp:read' | 'mcp:write',
  oauth: OauthClient,
  discover: OauthClient['discover'],
  store: CredentialStore | null,
  io: McpIo,
): Credential {
  return {
    kind: 'browser',
    store,
    login: () =>
      loopbackLogin({
        oauth: { discover, redeemCode: (server, input) => oauth.redeemCode(server, input) },
        listen: (state) =>
          listenOnLoopback({
            timeoutMs: SIGN_IN_TIMEOUT_MS,
            state,
            maxBadRequests: MAX_BAD_REQUESTS,
          }),
        openBrowser: io.openBrowser ?? createBrowserOpener(io.platform, io.run),
        entropy: io.entropy,
        say: io.stderr,
        clientId: MCP_CLIENT_ID,
        resource: ADMIN_API_AUDIENCE,
        scope,
      }),
    refresh: async (refreshToken) =>
      oauth.refresh(await discover(), { refreshToken, scope, resource: ADMIN_API_AUDIENCE }),
  };
}

function storeFor(target: StdioTarget, io: McpIo): CredentialStore {
  return createCredentialStore({
    account: target.issuer,
    directory: io.configDir,
    platform: io.platform,
    run: io.run,
    warn: io.stderr,
  });
}

async function keygen(io: McpIo): Promise<void> {
  const text = await generateClientKey();
  const key = await loadClientKey(text);
  io.stdout.write(`ODUDU_MCP_KEY=${text}\n`);
  io.stderr(JSON.stringify({ keys: [key.publicJwk] }));
}

// How long a call still running at end of input is waited for.
const DRAIN_MS = 25_000;

async function serve(
  tools: readonly RegisteredTool[],
  caller: Parameters<typeof callMcpTool>[2],
  io: McpIo,
): Promise<void> {
  const inFlight = new Set<Promise<ToolResult>>();
  const run = (tool: RegisteredTool, args: unknown): Promise<ToolResult> => {
    const requestId = randomUUID();
    // The admin API records a call made with a token issued to the agent, at its
    // door and before it runs, so there is nothing to record on this side.
    const call = callMcpTool(
      {
        requestId,
        deadlineMs: TOOL_DEADLINE_MS,
        record: () => Promise.resolve(),
        logger: {
          error: (context, message) => {
            io.stderr(failureLine(message, requestId, context.err));
          },
        },
      },
      tool,
      caller,
      args,
    );
    inFlight.add(call);
    const forget = () => inFlight.delete(call);
    call.then(forget, forget);
    return call;
  };
  const connection = serveMcpStdio({
    stdin: io.stdin,
    stdout: io.stdout,
    server: () => toolServer(tools, run),
    onerror: (error) => {
      io.stderr(failureLine('protocol error', 'transport', error));
    },
  });
  await connection.closed;
  // A call that began is let finish, so a write's outcome is known and recorded
  // before the process ends, for as long as is reasonable.
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, DRAIN_MS);
    timer.unref();
  });
  await Promise.race([Promise.allSettled([...inFlight]), limit]);
  clearTimeout(timer);
  await connection.close();
  // The process exits as soon as this returns; what was written is on the pipe first.
  await new Promise<void>((resolve) => {
    io.stdout.write('', () => {
      resolve();
    });
  });
}

async function start(values: Values, io: McpIo): Promise<void> {
  const { baseUrl, tenant } = required(values);
  const target = stdioTarget(baseUrl, tenant);
  const scope = values['allow-writes'] === true ? 'mcp:write' : 'mcp:read';
  if (values.logout === true) {
    await storeFor(target, io).clear();
    io.stderr(`odudu mcp: signed out of ${target.issuer}`);
    return;
  }
  const account = await serviceAccount(values, io);
  const oauth = createOauthClient(target, {
    fetch: io.fetch,
    now: io.now,
    publicClientId: MCP_CLIENT_ID,
  });
  const discover = discovering(oauth);
  const store = account === undefined && scope === 'mcp:read' ? storeFor(target, io) : null;
  // A refused store is the person's to fix, and is found before a client waits on us.
  await store?.get();
  const credential =
    account === undefined
      ? browserCredential(scope, oauth, discover, store, io)
      : keyCredential(account, oauth, discover, scope, io);
  const tokens = createTokenSource({
    now: io.now,
    issuer: async () => (await discover()).issuer,
    expectation: { audience: ADMIN_API_AUDIENCE, scope },
    credential,
    warn: io.stderr,
    ...(store === null
      ? {}
      : {
          lock: createFileLock({
            path: join(io.configDir, `refresh-${hashOf(target.issuer)}.lock`),
            staleMs: 30_000,
            waitMs: 10_000,
            pollMs: 100,
          }),
        }),
  });
  const caller = createHttpCaller(baseUrl, tokens, { tenant, fetch: io.fetch });
  await serve(visibleTools(TOOLS, [scope], null), caller, io);
}

// `odudu mcp`: the admin tools over stdio for a local MCP client. It reads no
// server configuration and opens no database: it is a client of an instance,
// authenticated as a service account (a key from the environment) or as a
// person (a sign-in in their browser, kept in the operating system's store).
// Every failure is one line on standard error and exit status 1.
export async function mcpCommand(argv: readonly string[], io: McpIo): Promise<number> {
  try {
    const values = checked(argv);
    if (values.keygen === true) await keygen(io);
    else await start(values, io);
    return 0;
  } catch (error) {
    io.stderr(
      error instanceof StdioError
        ? `odudu mcp: ${error.message.split('\n')[0] ?? 'failed'}`
        : failureLine('failed', 'startup', error),
    );
    return 1;
  }
}
