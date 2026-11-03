import { CONSOLE_FAULT, failureTextWith } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';

export function tenantChangeFailure(name: string, failure: GatewayFailure): string {
  const fault = () => `The console could not make the change. ${CONSOLE_FAULT}`;
  return failureTextWith({
    network: () =>
      `Could not confirm the change to ${name}. It has not been sent again; check its status before trying again.`,
    schema: fault,
    defect: fault,
    problem: ({ status, detail, title }) => {
      if (status === 412) {
        return `${name} changed elsewhere since you opened it. It has been read again; look at it before trying again.`;
      }
      if (status === 403) return 'This needs the manage-tenant capability.';
      return detail ?? title;
    },
  })(failure);
}

// What a save of the general section sends: only the fields that changed.
export function generalPatch(changes: { display_name?: string }): { display_name?: string } {
  return changes.display_name === undefined ? {} : { display_name: changes.display_name };
}
