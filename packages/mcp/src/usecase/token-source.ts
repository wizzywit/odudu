import { insufficientScopeProblem, type AdminAccess } from '#/service/admin-access';
import type { CredentialStore, RefreshLock } from '#/service/ports';
import { StdioError } from '#/service/stdio-error';
import { endsStoredSignIn, keepsRefreshToken, readsStoredSignIn } from '#/service/token-policy';
import {
  decodeStored,
  encodeStored,
  storedMatches,
  type StoredSignIn,
} from '#/service/stored-sign-in';
import type { TokenSource } from '#/service/token-source';
import { acceptTokenSet, type TokenSet } from '#/service/token-set';
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
  // The authorization server discovery found: the issuer a token must carry, and the
  // token endpoint a refresh token is presented to. Known once discovery has run.
  readonly authority: () => Promise<{ readonly issuer: string; readonly tokenEndpoint: string }>;
  readonly expectation: { readonly audience: string; readonly scope: 'mcp:read' | 'mcp:write' };
  readonly credential: Credential;
  // A token this close to expiring is replaced rather than used.
  readonly skewMs?: number;
  // After a failure nothing is tried again for this long.
  readonly cooldownMs?: number;
  // Taken around reading the stored sign-in, refreshing it and keeping the new one.
  readonly lock?: RefreshLock;
  // One line to a person, on standard error.
  readonly warn?: (line: string) => void;
}

const DEFAULT_SKEW_MS = 30_000;
const DEFAULT_COOLDOWN_MS = 60_000;

// What each call's bearer comes from: a token judged before it is used (this
// tenant's issuer, the admin API's audience, the scope this run asked for and
// nothing wider), kept until it nears expiry or the server refuses it, and
// fetched once however many calls are waiting for it. A failure is a tool error
// naming what to do, and is not repeated at the person for a minute.
export function createTokenSource(deps: TokenSourceDeps): TokenSource {
  const scope = deps.expectation.scope;
  const skewMs = deps.skewMs ?? DEFAULT_SKEW_MS;
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let current: TokenSet | undefined;
  let pending: Promise<TokenSet> | undefined;
  let failed: { readonly at: number; readonly message: string } | undefined;
  // A rotated refresh token the store would not take, used instead of the stale one it holds.
  let unsaved: StoredSignIn | undefined;
  let warned = false;

  async function keep(set: TokenSet): Promise<void> {
    const token = keepsRefreshToken(scope, set);
    const credential = deps.credential;
    if (token === undefined || credential.kind !== 'browser') return;
    const server = await deps.authority();
    const kept = {
      refreshToken: token,
      issuer: server.issuer,
      tokenEndpoint: server.tokenEndpoint,
    };
    try {
      await credential.store?.put(encodeStored(kept));
      unsaved = undefined;
    } catch {
      unsaved = kept;
      if (!warned)
        deps.warn?.('odudu mcp: the sign-in could not be stored; it is kept for this run only');
      warned = true;
    }
  }

  // What is stored is presented only to the server it was made at: one kept for another
  // issuer or token endpoint (a changed address, another `--tenant-address`) is forgotten, not sent.
  async function storedSignIn(
    credential: Extract<Credential, { kind: 'browser' }>,
  ): Promise<string | undefined> {
    if (!readsStoredSignIn(scope)) return undefined;
    const text = unsaved === undefined ? ((await credential.store?.get()) ?? null) : null;
    const held = unsaved ?? (text === null ? undefined : decodeStored(text));
    const server = await deps.authority();
    if (held !== undefined && storedMatches(held, server)) return held.refreshToken;
    if (held !== undefined || text !== null) {
      unsaved = undefined;
      await credential.store?.clear();
    }
    return undefined;
  }

  async function signedIn(credential: Extract<Credential, { kind: 'browser' }>): Promise<TokenSet> {
    const stored = await storedSignIn(credential);
    if (stored === undefined) return credential.login();
    try {
      return await credential.refresh(stored);
    } catch (error) {
      if (!endsStoredSignIn(error)) throw error;
      unsaved = undefined;
      await credential.store?.clear();
      return credential.login();
    }
  }

  // The new refresh token is stored before the access token is judged: the
  // server has already spent the old one, so a token judged unusable must not
  // cost the person the grant too.
  async function obtain(): Promise<TokenSet> {
    const credential = deps.credential;
    if (credential.kind === 'key') return credential.fetch();
    const set = await signedIn(credential);
    await keep(set);
    return set;
  }

  async function acquire(): Promise<TokenSet> {
    const credential = deps.credential;
    const guarded = credential.kind === 'browser' && readsStoredSignIn(scope);
    const set = guarded && deps.lock !== undefined ? await deps.lock.run(obtain) : await obtain();
    acceptTokenSet(set, { ...deps.expectation, issuer: (await deps.authority()).issuer });
    current = set;
    return set;
  }

  function coolingDown(): ToolProblem | undefined {
    if (failed === undefined || deps.now().getTime() - failed.at >= cooldownMs) return undefined;
    const seconds = Math.ceil(cooldownMs / 1000);
    return new ToolProblem(
      'mcp:sign_in_required',
      `${failed.message}; not tried again for ${String(seconds)} s`,
      401,
    );
  }

  return {
    invalidate(): void {
      current = undefined;
    },
    async bearer(access: AdminAccess): Promise<string> {
      if (access === 'write' && scope !== 'mcp:write') throw insufficientScopeProblem();
      if (current !== undefined && current.expiresAt.getTime() - skewMs > deps.now().getTime()) {
        return current.accessToken;
      }
      const cooling = coolingDown();
      if (cooling !== undefined) throw cooling;
      try {
        pending ??= acquire().finally(() => {
          pending = undefined;
        });
        const set = await pending;
        failed = undefined;
        return set.accessToken;
      } catch (error) {
        if (!(error instanceof StdioError)) throw error;
        failed = { at: deps.now().getTime(), message: error.message };
        throw new ToolProblem('mcp:sign_in_required', error.message, 401);
      }
    },
  };
}
