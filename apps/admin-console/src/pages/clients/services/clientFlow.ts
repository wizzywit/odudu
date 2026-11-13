import { AUTO } from '#/pages/clients/services/choices';
import type { FlowListItemWire } from '#/entities/flow';
import { isRefused } from '#/shared/lib/services/failure';
import type { GatewayFailure } from '#/shared/api/transport/gateway';
import type { Choice } from '#/shared/lib/services/choice';

export const FLOW_LABEL = 'Sign-in flow';

export const TENANT_DEFAULT = 'Tenant default';

export const FLOW_RULE =
  'The steps a person goes through to sign in to this application. Tenant default follows whichever flow the tenant marks as its default; choosing a flow by name keeps this client on it even when the default changes. A sign-in already under way stays on the flow it started with.';

// Tenant default first, then each flow of the tenant by name. A flow the client
// already names stays choosable while the list is unread, which needs a
// capability this client's own may not include, so the select never shows a
// value it has no option for.
export function flowChoices(
  flows: readonly Pick<FlowListItemWire, 'id' | 'name' | 'is_default'>[] | undefined,
  current: string | null,
): Choice[] {
  const listed: Choice[] = (flows ?? []).map((flow) => ({
    id: flow.id,
    label: flow.is_default ? `${flow.name} (the current default)` : flow.name,
  }));
  const unread =
    current !== null && !listed.some((choice) => choice.id === current)
      ? [{ id: current, label: current }]
      : [];
  return [{ id: AUTO, label: TENANT_DEFAULT }, ...listed, ...unread];
}

// A read that failed leaves the choice at two entries. A refusal is the expected
// answer to a holder of manage-clients without manage-tenant, so it says nothing.
export function flowsReadProblem(status: string, failure: GatewayFailure | null): string | null {
  if (status !== 'failed') return null;
  if (failure !== null && isRefused(failure)) return null;
  return `The flows could not be loaded, so only ${TENANT_DEFAULT} and the flow this client names are offered.`;
}
