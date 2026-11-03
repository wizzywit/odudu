import { loadCreation, storeCreation } from '#/entities/creation-draft/adapter/creationStorage';
import {
  administratorDraft,
  belongsTo,
  flowOf,
} from '#/entities/creation-draft/services/creationDraft';
import type { Creation, CreationFlow } from '#/entities/creation-draft/types/creation';

export function ownCreation(owner: string, flow: CreationFlow): Creation | null {
  const stored = loadCreation(owner, flow);
  return stored !== null && belongsTo(flow, stored) ? stored : null;
}

export function storedCreation(owner: string, tenant: string): Creation | null {
  return ownCreation(owner, flowOf(tenant));
}

export function beginOrResumeAdministrator(
  owner: string,
  tenant: string,
  origin: 'created' | 'imported' | 'existing',
): void {
  const draft = administratorDraft(storedCreation(owner, tenant), tenant, origin);
  storeCreation(owner, draft, flowOf(tenant));
}
