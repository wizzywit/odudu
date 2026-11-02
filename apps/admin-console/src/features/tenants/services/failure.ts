import { CONSOLE_FAULT } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';

export function tenantChangeFailure(name: string, failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not confirm the change to ${name}. It has not been sent again; check its status before trying again.`;
    case 'problem':
      if (failure.problem.status === 412) {
        return `${name} changed elsewhere since you opened it. It has been read again; look at it before trying again.`;
      }
      if (failure.problem.status === 403) return 'This needs the manage-tenant capability.';
      return failure.problem.detail ?? failure.problem.title;
    case 'schema':
    case 'defect':
      return `The console could not make the change. ${CONSOLE_FAULT}`;
  }
}
