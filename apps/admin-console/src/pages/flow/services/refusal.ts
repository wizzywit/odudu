import type { Step } from '#/pages/flow/services/steps';
import { andList } from '#/shared/lib/services/format';
import type { GatewayResult } from '#/shared/lib/services/result';

// The default flow's list is the body, a named flow's is under `steps`.
const STEP_AT = /^(?:steps)?\[(\d+)\]/u;

// The authenticator of the step a refusal's `errors[0].path` points at, in
// the list that was sent.
function stepNamed(path: string | undefined, sent: readonly Step[]): string | undefined {
  const at = STEP_AT.exec(path ?? '')?.[1];
  return at === undefined ? undefined : sent[Number(at)]?.authenticator;
}

function refusalText(
  type: string,
  title: string,
  path: string | undefined,
  sent: readonly Step[],
  available: readonly string[],
): string {
  const named = stepNamed(path, sent);
  switch (type) {
    case 'about:blank#flow-empty':
      return 'The flow has no step. Add one: nobody could sign in to a tenant with no flow.';
    case 'about:blank#flow-no-enabled-step':
      return 'Every step is disabled, so nobody could sign in. Enable at least one step.';
    case 'about:blank#flow-no-first-challenge':
      return 'Nothing in this order can start a sign-in. When it begins nobody is identified yet, so only the password step can run: the first step that cannot be skipped has to be password, or an alternative next to it, and it has to be enabled.';
    case 'about:blank#flow-unknown-authenticator':
      return `${
        named === undefined
          ? 'A step names an authenticator this server does not have.'
          : `“${named}” is not an authenticator this server has.`
      } It has ${andList(available)}.`;
    case 'about:blank#flow-duplicate-authenticator':
      return `${named === undefined ? 'An authenticator' : `“${named}”`} is a step twice. An authenticator is one step.`;
    default:
      return title;
  }
}

// A replacement's 400 said under the steps in the console's words, keyed on
// its problem type; a 400 of a type it does not know, a schema refusal the
// console never sends included, says its title. Anything else passes as it came.
export function flowOutcome<R>(
  result: GatewayResult<R>,
  sent: readonly Step[],
  available: readonly string[],
): GatewayResult<R> {
  if (result.ok || result.kind !== 'problem' || result.problem.status !== 400) return result;
  const { problem } = result;
  // A refused name is placed under the name by the section, as it came.
  if (problem.errors?.[0]?.path === 'name') return result;
  const text = refusalText(problem.type, problem.title, problem.errors?.[0]?.path, sent, available);
  return {
    ...result,
    problem: { ...problem, errors: [{ path: 'steps', message: text }] },
  };
}
