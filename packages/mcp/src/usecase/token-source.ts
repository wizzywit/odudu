import { insufficientScopeProblem, type AdminAccess } from '#/service/admin-access';
import type { CredentialStore } from '#/service/ports';
import { StdioError } from '#/service/stdio-error';
import type { TokenSource } from '#/service/token-source';
import {
  acceptTokenSet,
  holdsWrite,
  type TokenExpectation,
  type TokenSet,
} from '#/service/token-set';
import { ToolProblem } from '#/service/tool';

export type Credential =
  // A service account: a token from its key, asked for again when it lapses.
  | { readonly kind: 'key'; fetch(): Promise<TokenSet> }
  // A person: a stored refresh token where the run is read-only, else a sign-in.
  | {
      readonly kind: 'browser';
      readonly store: CredentialStore | null;
      login(): Promise<TokenSet>;
      refresh(refreshToken: string): Promise<TokenSet>;
    };

export interface TokenSourceDeps {
  readonly now: () => Date;
  readonly expectation: TokenExpectation;
  readonly credential: Credential;
  // A token this close to expiring is replaced rather than used.
  readonly skewMs?: number;
}

const DEFAULT_SKEW_MS = 30_000;

function writeRun(deps: TokenSourceDeps): boolean {
  return deps.expectation.scope === 'mcp:write';
}

// A run that allows writes never reads or keeps a refresh token: a write token
// is short-lived and is never refreshable, so each lapse is a new sign-in.
async function signedIn(
  credential: Extract<Credential, { kind: 'browser' }>,
  keepsRefreshToken: boolean,
): Promise<TokenSet> {
  const stored = keepsRefreshToken ? await credential.store?.get() : null;
  if (stored === null || stored === undefined) return credential.login();
  try {
    return await credential.refresh(stored);
  } catch (error) {
    if (!(error instanceof StdioError) || error.code !== 'mcp_grant_ended') throw error;
    await credential.store?.clear();
    return credential.login();
  }
}

async function obtain(deps: TokenSourceDeps): Promise<TokenSet> {
  const credential = deps.credential;
  return credential.kind === 'key' ? credential.fetch() : signedIn(credential, !writeRun(deps));
}

// A refresh token is kept for a read-only browser run, and never from a token
// that holds mcp:write, whatever the server sent with it.
async function keep(deps: TokenSourceDeps, set: TokenSet): Promise<void> {
  const credential = deps.credential;
  if (credential.kind !== 'browser' || writeRun(deps) || holdsWrite(set)) return;
  if (set.refreshToken !== undefined) await credential.store?.put(set.refreshToken);
}

// What each call's bearer comes from: a token judged before it is used (this
// tenant's issuer, the admin API's audience, the scope this run asked for and
// nothing wider), kept until it nears expiry, and fetched once however many
// calls are waiting for it. A failure is a tool error naming what to do.
export function createTokenSource(deps: TokenSourceDeps): TokenSource {
  const skewMs = deps.skewMs ?? DEFAULT_SKEW_MS;
  let current: TokenSet | undefined;
  let pending: Promise<TokenSet> | undefined;

  async function acquire(): Promise<TokenSet> {
    const set = await obtain(deps);
    acceptTokenSet(set, deps.expectation);
    await keep(deps, set);
    current = set;
    return set;
  }

  return {
    async bearer(access: AdminAccess): Promise<string> {
      if (access === 'write' && !writeRun(deps)) throw insufficientScopeProblem();
      if (current !== undefined && current.expiresAt.getTime() - skewMs > deps.now().getTime()) {
        return current.accessToken;
      }
      try {
        pending ??= acquire().finally(() => {
          pending = undefined;
        });
        return (await pending).accessToken;
      } catch (error) {
        if (!(error instanceof StdioError)) throw error;
        throw new ToolProblem('mcp:sign_in_required', error.message, 401);
      }
    },
  };
}
