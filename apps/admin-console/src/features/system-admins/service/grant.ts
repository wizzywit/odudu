import {
  ADMINISTRATOR_REQUEST_NEEDS,
  type AdministratorRequest,
} from '#/shared/service/administrators.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { holdingLabel, isHolding } from '#/shared/service/capabilities';
import type { GatewayFailure } from '#/shared/service/result.ts';

export function grantFailureText(
  name: string,
  refused: { failure: GatewayFailure; request: AdministratorRequest },
): string {
  const { failure, request } = refused;
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${name} was given it. Check the list before trying again.`;
    case 'schema':
      return `${name} may have been given it, but the answer could not be read. Check the list.`;
    case 'defect':
      return writeFailureText(failure, { name, verb: 'given it', lookAt: 'the list' });
    case 'problem': {
      const { problem } = failure;
      const why =
        problem.status === 403
          ? (problem.detail ?? `it needs the ${ADMINISTRATOR_REQUEST_NEEDS[request]} capability`)
          : problem.status === 412
            ? 'their roles changed while this ran. Try again'
            : (problem.detail ?? problem.title);
      return `${name} was not given it: ${why}.`;
    }
  }
}

export function grantedText(name: string, holdings: readonly string[]): string {
  return `${name} now holds ${holdings.filter(isHolding).map(holdingLabel).join(', ')} in system.`;
}
