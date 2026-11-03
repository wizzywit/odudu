import type { EvaluatedClaims } from '#/pages/clients/types/evaluation';
import { writeFailureText } from '#/shared/lib/services/failure';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';

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
  // Names the box to a person who sees it; the label names it to a screen reader and the Copy button.
  heading: string;
  label: string;
  // Null when there is none, such as an ID token without openid.
  text: string | null;
}

export function artefactsOf(result: EvaluatedClaims): Artefact[] {
  const show = (claims: unknown): string => JSON.stringify(claims, null, 2);
  return [
    {
      heading: 'What the app gets in the ID token',
      label: 'ID token claims',
      text: result.id_token === null ? null : show(result.id_token),
    },
    {
      heading: 'What the app gets in the access token',
      label: 'Access token claims',
      text: show(result.access_token),
    },
    {
      heading: 'What UserInfo returns',
      label: 'UserInfo claims',
      text: show(result.userinfo),
    },
  ];
}

export const NO_ID_TOKEN = "No ID token. The scope doesn't include openid.";

export function evaluatedScope(result: EvaluatedClaims): string {
  return result.scope === '' ? 'no scope' : result.scope;
}

export function evaluateFailureText(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The evaluation',
    verb: 'carried out',
    lookAt: 'the audit trail',
  });
}

// One press of Evaluate: the same subject and scope asked twice are two
// questions, since each is audited.
export interface Asked {
  subject: string;
  scope: string;
  press: number;
}

export function askedAfter(was: Asked | null, subject: string, scope: string): Asked {
  return { subject, scope, press: (was?.press ?? 0) + 1 };
}

export function askedParts(asked: Asked | null): readonly [string, string, number] {
  return [asked?.subject ?? '', asked?.scope ?? '', asked?.press ?? 0];
}

export interface Evaluation {
  // Nothing was asked, the answer is awaited, or it came.
  status: 'idle' | 'loading' | 'ready';
  result: GatewayResult<EvaluatedClaims> | null;
}

export function evaluationOf(
  asked: Asked | null,
  answer: GatewayResult<EvaluatedClaims> | null | undefined,
): Evaluation {
  if (asked === null) return { status: 'idle', result: null };
  return answer === undefined
    ? { status: 'loading', result: null }
    : { status: 'ready', result: answer };
}

export function answerShown(answer: GatewayResult<EvaluatedClaims> | null): {
  problem: string | null;
  // The scope the answer was worked out for, and the claims it came to.
  worked: string | null;
  artefacts: readonly Artefact[];
} {
  if (answer === null) return { problem: null, worked: null, artefacts: [] };
  if (!answer.ok) return { problem: evaluateFailureText(answer), worked: null, artefacts: [] };
  return {
    problem: null,
    worked: evaluatedScope(answer.data),
    artefacts: artefactsOf(answer.data),
  };
}
