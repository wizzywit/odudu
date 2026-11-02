import {
  againOf,
  holdsText,
  systemHoldsText,
  type Creation,
  type CreationFlow,
} from '#/features/tenants/services/creation';
import { systemAdminsHrefOf, tenantHref } from '#/features/tenants/services/address';
import { tenantPage } from '#/shared/services/address';

export interface DoneStep {
  step: 'done';
  tenant: string;
  username: string;
  // What they were given, as a sentence fragment: "tenant-admin".
  holds: string;
  // What a system administrator is said to hold, around "in system".
  systemHolds: string;
  // Starting over from a tenant's own administrator adds another to it.
  again: 'tenant' | 'administrator';
  systemAdminsHref: string | null;
  recordHref: string;
  enterHref: string;
}

export function doneStepOf(
  creation: Extract<Creation, { step: 'done' }>,
  flow: CreationFlow,
): DoneStep {
  const holds = holdsText(creation.holdings);
  return {
    step: 'done',
    tenant: creation.tenant,
    username: creation.username,
    holds,
    systemHolds: systemHoldsText(holds),
    again: againOf(flow),
    systemAdminsHref: systemAdminsHrefOf(creation.tenant),
    recordHref: tenantHref(creation.tenant),
    enterHref: tenantPage(creation.tenant),
  };
}
