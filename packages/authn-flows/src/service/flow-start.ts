import { PASSWORD } from '#/service/authenticators/names';
import { nextStep, type Step } from '#/service/requirements';
import { type Requirement } from '#/schema/execution';

export interface OrderedStep {
  readonly authenticator: string;
  readonly requirement: Requirement;
}

/**
 * Whether `initialChallenge` would have anything to render for this flow.
 * At login start no subject is bound and nothing has been submitted, so
 * `password` is the only step that applies — `isApplicable`
 * (#/usecase/executor.ts) is where that is decided, and this mirrors the
 * one case it can answer with no facts to read. A flow of conditional or
 * alternative steps that all stand down answers `complete` or `fail`, both
 * of which reach the caller as `no_applicable_execution`: a tenant nobody
 * can sign into.
 */
export function startsALogin(steps: readonly OrderedStep[]): boolean {
  const atStart: Step[] = steps.map((step) => ({
    authenticator: step.authenticator,
    requirement: step.requirement,
    applicable: step.authenticator === PASSWORD,
  }));
  return nextStep(atStart, { satisfied: new Set() }).kind === 'run';
}
