import type { EvaluateClaimsResponse } from '@odudu/contracts/admin';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export const EVALUATE_HEADING = 'Evaluate';
export const EVALUATE_RULE =
  'The claims a sign-in of one subject through this client would be issued, worked out as issuance works them out. Nothing is signed or issued, and the evaluation is recorded in the audit trail. It assumes consent is given.';

export const EVALUATE_CAPABILITY = 'view-users';

export const SUBJECT_PICKER_LABEL = 'Subject to evaluate';
export const SCOPE_LABEL = 'Scope';
export const SCOPE_RULE =
  "Scope names, separated by spaces, as a request would carry them. Left empty, the client's default scopes.";

export const EVALUATE_LABEL = 'Evaluate claims';

export interface Artefact {
  label: string;
  // Null when there is none, such as an ID token without openid.
  text: string | null;
}

export function artefactsOf(result: EvaluateClaimsResponse): Artefact[] {
  const show = (claims: unknown): string => JSON.stringify(claims, null, 2);
  return [
    { label: 'ID token claims', text: result.id_token === null ? null : show(result.id_token) },
    { label: 'Access token claims', text: show(result.access_token) },
    { label: 'UserInfo claims', text: show(result.userinfo) },
  ];
}

export const NO_ID_TOKEN = 'No ID token: the scope names no openid.';

export function evaluatedScope(result: EvaluateClaimsResponse): string {
  return result.scope === '' ? 'no scope' : result.scope;
}

export function evaluateFailureText(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The claims',
    verb: 'worked out',
    lookAt: 'the audit trail',
  });
}
