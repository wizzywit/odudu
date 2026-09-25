import { PASSWORD } from '#/service/authenticators/names';
import { nextStep, type Step } from '#/service/requirements';
import { type Requirement } from '#/schema/execution';

export interface OrderedStep {
  readonly authenticator: string;
  readonly requirement: Requirement;
}

/**
 * Whether `initialChallenge` would have anything to render for this flow.
 * At login start `password` is the only applicable step — `isApplicable`
 * (#/usecase/executor.ts) decides that, and `tests/multi-step.int.test.ts`
 * holds it there, so a change goes red rather than silently over-refusing
 * flows through this copy. A flow whose conditional or alternative steps
 * all stand down answers `no_applicable_execution`: a tenant nobody can
 * sign into.
 */
export function startsALogin(steps: readonly OrderedStep[]): boolean {
  const atStart: Step[] = steps.map((step) => ({
    authenticator: step.authenticator,
    requirement: step.requirement,
    applicable: step.authenticator === PASSWORD,
  }));
  return nextStep(atStart, { satisfied: new Set() }).kind === 'run';
}
