import {
  ADMINISTRATOR_REQUEST_NEEDS,
  type AdministratorRequest,
} from '#/shared/services/administrators';
import { failureTextWith } from '#/shared/services/failure';
import { holdingLabel, isHolding } from '#/shared/services/capabilities';
import type { GatewayFailure } from '#/shared/services/result';

export function grantFailureText(
  name: string,
  refused: { failure: GatewayFailure; request: AdministratorRequest },
): string {
  const { failure, request } = refused;
  return failureTextWith(
    {
      network: () =>
        `Could not confirm whether ${name} was given it. Check the list before trying again.`,
      schema: () =>
        `${name} may have been given it, but the answer could not be read. Check the list.`,
      problem: ({ status, detail, title }) => {
        const why =
          status === 403
            ? (detail ?? `it needs the ${ADMINISTRATOR_REQUEST_NEEDS[request]} capability`)
            : status === 412
              ? 'their roles changed while this ran. Try again'
              : (detail ?? title);
        return `${name} was not given it: ${why}.`;
      },
    },
    { name, verb: 'given it', lookAt: 'the list' },
  )(failure);
}

export function grantedText(name: string, holdings: readonly string[]): string {
  return `${name} now holds ${holdings.filter(isHolding).map(holdingLabel).join(', ')} in system.`;
}
