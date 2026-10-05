import type { GatewayFailure } from '#/shared/service/result.ts';

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
      return 'The console could not make the change. This is a fault in the console, not something you did.';
  }
}
