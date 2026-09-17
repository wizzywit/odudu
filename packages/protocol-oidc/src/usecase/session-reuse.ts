import { type PromptValue } from '#/service/prompt';

export interface ResolvedSession {
  readonly subjectId: string;
  readonly authTime: Date;
}

export interface ReuseInput {
  readonly session: ResolvedSession | null;
  readonly prompts: ReadonlySet<PromptValue>;
  readonly maxAge: number | null;
  readonly now: Date;
}

export type ReuseDecision =
  | { readonly kind: 'reuse'; readonly subjectId: string; readonly authTime: Date }
  | { readonly kind: 'authenticate' }
  | { readonly kind: 'refuse'; readonly error: string };

// OIDC Core §3.1.2.1 and §3.1.2.3. `prompt=none` forbids any user
// interface, so whenever this would otherwise authenticate, it refuses
// instead — which is why the two are checked together rather than in
// sequence.
export function decideReuse(input: ReuseInput): ReuseDecision {
  const silent = input.prompts.has('none');
  const mustReauthenticate =
    input.prompts.has('login') ||
    (input.session !== null &&
      input.maxAge !== null &&
      input.now.getTime() - input.session.authTime.getTime() >= input.maxAge * 1000);

  if (input.session === null || mustReauthenticate) {
    return silent ? { kind: 'refuse', error: 'login_required' } : { kind: 'authenticate' };
  }
  return { kind: 'reuse', subjectId: input.session.subjectId, authTime: input.session.authTime };
}
