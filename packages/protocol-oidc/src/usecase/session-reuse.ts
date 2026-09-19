import { type PromptValue } from '#/service/prompt';

export interface ResolvedSession {
  readonly id: string;
  readonly subjectId: string;
  readonly authTime: Date;
}

export interface ReuseInput {
  readonly sessions: readonly ResolvedSession[];
  readonly prompts: ReadonlySet<PromptValue>;
  readonly maxAge: number | null;
  readonly now: Date;
}

export type ReuseDecision =
  | {
      readonly kind: 'reuse';
      readonly sessionId: string;
      readonly subjectId: string;
      readonly authTime: Date;
    }
  | { readonly kind: 'select'; readonly candidates: readonly ResolvedSession[] }
  | { readonly kind: 'authenticate' }
  | { readonly kind: 'refuse'; readonly error: string };

function withinMaxAge(session: ResolvedSession, maxAge: number | null, now: Date): boolean {
  if (maxAge === null) return true;
  return now.getTime() - session.authTime.getTime() < maxAge * 1000;
}

// OIDC Core §3.1.2.1, §3.1.2.3 and §3.1.2.6. `prompt=none` forbids any user
// interface, so wherever this would otherwise ask — for credentials or for
// an account — it refuses instead, with the error that names what it would
// have asked for.
export function decideReuse(input: ReuseInput): ReuseDecision {
  const silent = input.prompts.has('none');
  if (input.prompts.has('login')) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }

  const candidates = input.sessions.filter((session) =>
    withinMaxAge(session, input.maxAge, input.now),
  );

  if (candidates.length === 0) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }

  const first = candidates[0];
  if (candidates.length === 1 && !input.prompts.has('select_account') && first !== undefined) {
    return {
      kind: 'reuse',
      sessionId: first.id,
      subjectId: first.subjectId,
      authTime: first.authTime,
    };
  }

  return silent
    ? { kind: 'refuse', error: 'account_selection_required' }
    : { kind: 'select', candidates };
}
