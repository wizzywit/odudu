import { type Principal } from '#/shared/service/principal.ts';
import type { GatewayResult, Problem } from '#/shared/service/result.ts';
import { SESSION_ENDED_TYPE, isSessionEnded } from '#/shared/service/sessionEnded.ts';

export function draftOwner(principal: Principal): string {
  return `${principal.tenant}/${principal.subjectId}`;
}

// A session read that answers within this is over before a placeholder
// would be seen, so none is drawn.
export const PLACEHOLDER_DELAY_MS = 200;

// What the session query holds. `was` is who this tab was showing when its
// session ended, or when a sign-in in another tab replaced it with the
// principal `result` names.
export interface SessionRead {
  result: GatewayResult<Principal>;
  was: Principal | null;
}

// The principal the tab is showing: the one it read, or while it asks about
// a replacement, the one it read before that.
export function shownPrincipal(read: SessionRead | undefined): Principal | null {
  if (read?.result.ok !== true) return null;
  return read.was ?? read.result.data;
}

export type BootState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'replaced'; was: Principal; now: Principal }
  | { kind: 'ready'; principal: Principal | null; ended: Principal | null };

export function bootOf(read: SessionRead | undefined): BootState {
  if (read === undefined) return { kind: 'loading' };
  const { result, was } = read;
  if (result.ok) {
    return was === null
      ? { kind: 'ready', principal: result.data, ended: null }
      : { kind: 'replaced', was, now: result.data };
  }
  if (result.kind === 'problem' && isSessionEnded(result.problem)) {
    return { kind: 'ready', principal: null, ended: was };
  }
  return { kind: 'failed' };
}

// A read naming somebody other than the principal shown is another tab's
// sign-in.
export function isReplacement(shown: Principal, now: Principal): boolean {
  return draftOwner(shown) !== draftOwner(now);
}

export type SignOutAnswer =
  | { ok: true; redirect: string }
  | { ok: false; kind: 'network' | 'schema' }
  | { ok: false; kind: 'problem'; problem: Problem };

// The session is gone once the gateway has answered for it: signed out, or
// already ended, or signed out with a redirect the console will not follow.
export function sessionGone(result: SignOutAnswer): boolean {
  return (
    result.ok ||
    result.kind === 'schema' ||
    (result.kind === 'problem' && isSessionEnded(result.problem))
  );
}

// What a tab holds once the gateway has said its session is over.
export function sessionEndedRead(): GatewayResult<Principal> {
  return {
    ok: false,
    kind: 'problem',
    problem: { type: SESSION_ENDED_TYPE, title: 'Unauthorized', status: 401 },
  };
}
