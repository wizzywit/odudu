import { AUTO } from '#/pages/clients/services/choices';
import type { FlowListItemWire } from '#/entities/flow';
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
