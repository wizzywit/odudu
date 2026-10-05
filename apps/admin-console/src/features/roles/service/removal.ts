import {
  asksFirst,
  lossText,
  type Asked,
  type Loss,
  writeRefusal,
} from '#/shared/service/capabilities.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';
import { compositeRefusal } from '#/features/roles/service/blocks.ts';
import { type Ceiling } from '#/features/roles/service/ceiling.ts';

export function compositeRemovalConfirmation(role: string, child: string, loss: Loss): Asked {
  return {
    title: 'Take out a role your own access runs through?',
    consequence: `Whoever holds ${role} no longer holds ${child} through it.${lossText(loss, `${child} nested in ${role}`)}`,
  };
}

export function unnestedText(child: string, role: string): string {
  return `${child} is no longer nested in ${role}.`;
}

export function compositeRemovalFailureText(
  role: string,
  child: string,
  failure: GatewayFailure,
): string {
  if (failure.kind !== 'problem') {
    return `Could not confirm whether ${child} was taken out. Look at the list before trying again.`;
  }
  return writeFailureText(failure, {
    name: child,
    verb: 'taken out',
    lookAt: 'the list',
    stale: `${role}'s composites changed since you opened them, so ${child} was not taken out. They have been read again; look before trying again.`,
    refused: (problem) => compositeRefusal(child, problem),
  });
}

export type RemovalAction = 'wait' | 'ask' | 'run';

export function removalAction(loss: Loss): RemovalAction {
  if (loss.kind === 'checking') return 'wait';
  return asksFirst(loss) ? 'ask' : 'run';
}

export function deleteChecking(ceiling: Ceiling, loss: Loss): boolean {
  return ceiling.status !== 'ready' || loss.kind === 'checking';
}

export function roleDeleteConsequence(name: string, loss: Loss): string {
  return `${name} is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.${lossText(loss, name)}`;
}

export function roleDeleteFailureText(name: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name,
    verb: 'deleted',
    lookAt: 'the roles',
    refused: (problem) =>
      problem.status === 409 && problem.detail !== undefined
        ? `Refused: ${problem.detail}.`
        : writeRefusal(problem),
  });
}
